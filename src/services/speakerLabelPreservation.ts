// Carry user-assigned speaker names across a re-diarisation.
//
// THE BUG THIS FIXES
// rediarisationService deleted the entire `speaker_tagged` segment version and
// rebuilt it from the new diarisation output. Every manual rename and every
// AI-suggested merge was destroyed, and speakers reverted to pyannote's raw
// SPEAKER_00… labels. The user tags speakers carefully, re-runs diarisation to fix
// a boundary, and silently loses all their work.
//
// HOW IT WORKS
// Diarisation speaker ids are arbitrary and are reassigned on every run
// (SPEAKER_00 in one run is not necessarily the same voice as SPEAKER_00 in the
// next), so ids cannot be compared directly. What CAN be compared is *when* each
// label was active: the old tagged segments and the new alignment describe the
// same audio over the same time range. So each new cluster is matched to the old
// cluster it overlaps most, and inherits that cluster's user-assigned name.
//
// CONFIDENCE
// A match is only accepted when one old label dominates the new cluster's overlap.
// A new cluster that overlaps several old labels roughly equally is genuinely
// ambiguous — it may be two voices the new run merged, or one voice the old run
// split — so it is reported for review rather than guessed at. Guessing wrong is
// worse than asking: a confidently mislabelled speaker corrupts every downstream
// per-speaker view and export.

/** Shape we need from a stored `speaker_tagged` segment. */
export interface TimedSpeaker {
  speaker?: string | null;
  start_time?: number | null;
  end_time?: number | null;
}

/** Shape we need from `transcripts.speakers`. */
export interface NamedSpeaker {
  id: string;
  name: string;
}

export interface PreservationResult {
  /** newSpeakerId -> name to display (user name where confidently mapped). */
  labels: Map<string, string>;
  /** New clusters whose mapping was ambiguous or absent; needs user review. */
  needsReview: string[];
}

/**
 * Extract the renames the user actually made.
 *
 * Only entries where the display name differs from the id count as a rename — an
 * untouched diarisation has speakers whose name IS their id, and treating those
 * as renames would freeze SPEAKER_00 labels onto whatever cluster happens to
 * overlap next run, which is exactly the staleness we're removing.
 */
export function buildRenameMap(speakers: NamedSpeaker[] | undefined | null): Map<string, string> {
  const renames = new Map<string, string>();
  for (const speaker of speakers ?? []) {
    if (!speaker?.id || !speaker?.name) continue;
    if (speaker.id === speaker.name) continue;
    renames.set(speaker.id, speaker.name);
  }
  return renames;
}

/** Overlap in seconds between two [start, end) spans, 0 when disjoint. */
function overlapSec(
  aStart: number | null | undefined,
  aEnd: number | null | undefined,
  bStart: number | null | undefined,
  bEnd: number | null | undefined
): number {
  if (
    typeof aStart !== 'number' ||
    typeof aEnd !== 'number' ||
    typeof bStart !== 'number' ||
    typeof bEnd !== 'number'
  ) {
    return 0;
  }
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** How much of the total does the winning old label account for? */
const DOMINANCE_THRESHOLD = 0.6;

/**
 * Map new diarisation clusters onto the user's existing speaker names.
 *
 * @param newlyAligned  Chunks from the fresh diarisation run, with new speaker ids.
 * @param previouslyTagged The old `speaker_tagged` segments, with the ids the user
 *                        was looking at before this run.
 * @param renames       old id -> user-assigned name, from buildRenameMap.
 */
export function preserveSpeakerLabels(
  newlyAligned: TimedSpeaker[],
  previouslyTagged: TimedSpeaker[],
  renames: Map<string, string>
): PreservationResult {
  const labels = new Map<string, string>();
  const needsReview: string[] = [];

  const usableOld = previouslyTagged.filter(
    (s) => s.speaker && typeof s.start_time === 'number' && typeof s.end_time === 'number'
  );

  if (usableOld.length === 0) return { labels, needsReview };

  // For each new speaker, accumulate overlap against every old speaker label.
  const overlapByNew = new Map<string, Map<string, number>>();
  for (const chunk of newlyAligned) {
    const newId = chunk.speaker;
    if (!newId || typeof chunk.start_time !== 'number' || typeof chunk.end_time !== 'number') {
      continue;
    }
    let tally = overlapByNew.get(newId);
    if (!tally) {
      tally = new Map<string, number>();
      overlapByNew.set(newId, tally);
    }
    for (const old of usableOld) {
      const seconds = overlapSec(
        chunk.start_time,
        chunk.end_time,
        old.start_time,
        old.end_time
      );
      if (seconds > 0) {
        tally.set(old.speaker as string, (tally.get(old.speaker as string) ?? 0) + seconds);
      }
    }
  }

  for (const [newId, tally] of overlapByNew) {
    let bestLabel: string | null = null;
    let bestSeconds = 0;
    let total = 0;
    for (const [label, seconds] of tally) {
      total += seconds;
      if (seconds > bestSeconds) {
        bestSeconds = seconds;
        bestLabel = label;
      }
    }

    // No usable prior tag for this cluster — nothing to preserve, and nothing the
    // user would recognise as lost.
    if (!bestLabel || bestSeconds <= 0) continue;

    const dominance = total > 0 ? bestSeconds / total : 0;
    const userName = renames.get(bestLabel);

    if (!userName) {
      // Matched a prior cluster that was never renamed, so there is no name worth
      // carrying. Not a review item — the user never named it.
      continue;
    }

    if (dominance >= DOMINANCE_THRESHOLD) {
      labels.set(newId, userName);
    } else {
      // The new run appears to have split or merged voices around here. Carry
      // nothing and tell the user which cluster needs a decision.
      needsReview.push(newId);
    }
  }

  return { labels, needsReview };
}