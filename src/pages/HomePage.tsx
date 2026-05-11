import React, { useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ServiceContext } from '../contexts/ServiceContext';
import { TranscriptContext } from '../contexts/TranscriptContext';
import { useProjects } from '../contexts/ProjectContext';
import { formatDistanceToNow, formatDuration } from '../utils/helpers';
import { Clock, FolderOpen, ArrowRight, Activity, TrendingUp, FileText, Star } from 'lucide-react';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { serviceStatus } = useContext(ServiceContext);
  const { recentTranscripts, loadTranscripts } = useContext(TranscriptContext);
  const { projects } = useProjects();

  useEffect(() => {
    loadTranscripts();
  }, []);

  const getConnectionStatus = () => {
    if (serviceStatus.speechToText === 'connected' && serviceStatus.aiAnalysis === 'connected') {
      return { text: 'All services connected', color: 'text-success', dotColor: 'bg-success' };
    } else if (serviceStatus.speechToText === 'error' || serviceStatus.aiAnalysis === 'error') {
      return { text: 'Service connection error', color: 'text-error', dotColor: 'bg-error' };
    } else {
      return { text: 'Connecting to services...', color: 'text-warning', dotColor: 'bg-warning' };
    }
  };

  const connectionStatus = getConnectionStatus();

  const mostActiveProjects = projects
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 3);

  const mostRecentTranscripts = recentTranscripts.slice(0, 5);

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-10 animate-fade-in">
        <div>
          <h1 className="text-3xl font-display text-surface-900 tracking-tight">
            Welcome to Debrief
          </h1>
          <p className="text-surface-500 mt-1 text-sm">Your recent activity and quick access</p>
        </div>
        <div className={`flex items-center gap-2 ${connectionStatus.color}`}>
          <div className={`w-2 h-2 rounded-full ${connectionStatus.dotColor}`} />
          <span className="text-xs font-medium">{connectionStatus.text}</span>
        </div>
      </div>

      {/* Recent Activity Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Recent Transcripts */}
        <div className="card-interactive p-6 animate-slide-up" style={{ animationDelay: '0.05s', opacity: 0 }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-display text-surface-900">Recent Transcripts</h2>
            <div className="flex items-center gap-2">
              <Activity className="text-success" size={16} />
              <span className="text-xs text-surface-500">{mostRecentTranscripts.length} of {recentTranscripts.length}</span>
            </div>
          </div>
          {mostRecentTranscripts.length > 0 ? (
            <div className="space-y-1">
              {mostRecentTranscripts.map((transcript) => (
                <div
                  key={transcript.id}
                  className={`cursor-pointer hover:bg-surface-50 p-3 rounded-lg transition-all duration-200 group`}
                  onClick={() => navigate(`/transcript/${transcript.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-primary-400 flex-shrink-0" />
                    <h3 className="font-medium text-surface-800 text-sm truncate group-hover:text-primary-900 transition-colors">
                      {transcript.title}
                    </h3>
                    {transcript.starred && <Star size={12} className="text-accent-500 flex-shrink-0" fill="currentColor" />}
                  </div>
                  <div className="text-xs text-surface-400 flex items-center gap-2 mt-1 ml-[22px]">
                    <span>{formatDistanceToNow(new Date(transcript.created_at))} ago</span>
                    <span className="text-surface-200">&middot;</span>
                    <span>{formatDuration(transcript.duration)}</span>
                    <span className="text-surface-200">&middot;</span>
                    <span className={`badge text-[10px] py-0 px-1.5 ${
                      transcript.status === 'completed' ? 'badge-success' :
                      transcript.status === 'processing' ? 'badge-info' :
                      transcript.status === 'error' ? 'badge-error' : 'badge-neutral'
                    }`}>
                      {transcript.status}
                    </span>
                  </div>
                </div>
              ))}
              <button
                onClick={() => navigate('/library')}
                className="link-accent text-sm flex items-center gap-1 mt-3 w-full justify-center py-2.5 border border-accent-200 hover:border-accent-300 rounded-lg transition-colors"
              >
                View all transcripts ({recentTranscripts.length})
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <div className="text-center text-surface-400 text-sm py-10">
              <Clock className="mx-auto mb-3 text-surface-300" size={28} />
              <p className="font-medium text-surface-600">No transcripts yet</p>
              <p className="mt-1 text-xs">Use Upload & Process in the sidebar to get started</p>
            </div>
          )}
        </div>

        {/* Most Active Projects */}
        <div className="card-interactive p-6 animate-slide-up" style={{ animationDelay: '0.1s', opacity: 0 }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-display text-surface-900">Most Active Projects</h2>
            <div className="flex items-center gap-2">
              <TrendingUp className="text-accent-500" size={16} />
              <span className="text-xs text-surface-500">{mostActiveProjects.length} of {projects.length}</span>
            </div>
          </div>
          {mostActiveProjects.length > 0 ? (
            <div className="space-y-1">
              {mostActiveProjects.map((project) => (
                <div
                  key={project.id}
                  className="cursor-pointer hover:bg-surface-50 p-3 rounded-lg transition-all duration-200 group"
                  onClick={() => navigate(`/project/${project.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                      <FolderOpen size={15} className="text-primary-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-surface-800 text-sm truncate group-hover:text-primary-900 transition-colors">
                        {project.name}
                      </h3>
                      <div className="text-xs text-surface-400 flex items-center gap-2 mt-0.5">
                        <span>{project.transcript_count || 0} transcripts</span>
                        {project.total_duration && project.total_duration > 0 && (
                          <>
                            <span className="text-surface-200">&middot;</span>
                            <span>{formatDuration(project.total_duration)}</span>
                          </>
                        )}
                        <span className="text-surface-200">&middot;</span>
                        <span>Updated {formatDistanceToNow(new Date(project.updated_at))} ago</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={() => navigate('/projects')}
                className="link-accent text-sm flex items-center gap-1 mt-3 w-full justify-center py-2.5 border border-accent-200 hover:border-accent-300 rounded-lg transition-colors"
              >
                View all projects ({projects.length})
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <div className="text-center text-surface-400 text-sm py-10">
              <FolderOpen className="mx-auto mb-3 text-surface-300" size={28} />
              <p className="font-medium text-surface-600">No projects yet</p>
              <button
                onClick={() => navigate('/projects')}
                className="link-accent mt-2 text-sm"
              >
                Create your first project
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="bg-surface-100 rounded-xl p-6 animate-slide-up" style={{ animationDelay: '0.15s', opacity: 0 }}>
        <h2 className="text-lg font-display text-surface-900 mb-4">Your Activity</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { value: recentTranscripts.length, label: 'Total Transcripts', color: 'text-primary-800', icon: FileText },
            { value: projects.length, label: 'Projects', color: 'text-accent-600', icon: FolderOpen },
            {
              value: recentTranscripts.reduce((total, t) => total + (t.duration || 0), 0) > 0
                ? formatDuration(recentTranscripts.reduce((total, t) => total + (t.duration || 0), 0))
                : '0m',
              label: 'Total Duration',
              color: 'text-success',
              icon: Clock
            },
            { value: recentTranscripts.filter(t => t.starred).length, label: 'Starred Items', color: 'text-accent-500', icon: Star },
          ].map((stat, i) => {
            const Icon = stat.icon;
            return (
              <div key={i} className="bg-white rounded-xl p-4 shadow-card">
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={14} className={stat.color} />
                  <span className="text-xs text-surface-500">{stat.label}</span>
                </div>
                <div className={`text-2xl font-display ${stat.color}`}>{stat.value}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
