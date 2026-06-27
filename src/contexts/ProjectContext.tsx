import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Project, Transcript } from '../types';
import { generateId } from '../utils/helpers';
import { projectAnalysisService } from '../services/projectAnalysisService';
import { hydrateTranscriptRow, hydrateProjectRow } from '../utils/hydration';

interface ProjectContextType {
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;
  error: string | null;
  
  // Project operations
  createProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  
  // Transcript management
  addTranscriptToProject: (projectId: string, transcriptId: string) => Promise<void>;
  removeTranscriptFromProject: (projectId: string, transcriptId: string) => Promise<void>;
  getProjectTranscripts: (projectId: string) => Promise<Transcript[]>;
  
  // Analysis
  analyzeProject: (projectId: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const useProjects = () => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjects must be used within a ProjectProvider');
  }
  return context;
};

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load all projects
  const loadProjects = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const result = await window.electronAPI.db.projectTranscripts.listProjectsWithStats();

      const projectsWithMetadata = result.map((row) => ({
        ...hydrateProjectRow(row),
        date_range: row.earliest_transcript && row.latest_transcript ? {
          start: row.earliest_transcript,
          end: row.latest_transcript
        } : undefined
      }));
      
      setProjects(projectsWithMetadata);
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError('Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Create a new project
  const createProject = async (name: string, description?: string): Promise<Project> => {
    try {
      const project: Project = {
        id: generateId(),
        name,
        description,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        themes: [],
        key_insights: [],
        tags: [],
        color: '#667eea', // Default purple
        icon: '📁'
      };
      
      await window.electronAPI.db.projects.create({
        id: project.id,
        name: project.name,
        description: project.description || null,
        themes: project.themes,
        key_insights: project.key_insights,
        tags: project.tags,
        color: project.color,
        icon: project.icon,
      });

      await loadProjects();
      return project;
    } catch (err) {
      console.error('Failed to create project:', err);
      throw new Error('Failed to create project');
    }
  };

  // Update a project
  const updateProject = async (id: string, updates: Partial<Project>) => {
    try {
      // Cherry-pick the editable columns so the context's hydrated extras
      // (transcript_count, date_range, ...) never reach the RPC allow-list.
      // The RPC serializes the JSON columns (themes/key_insights/tags) itself.
      const fields: Record<string, unknown> = {};
      const editable = ['name', 'description', 'themes', 'key_insights', 'summary', 'tags', 'color', 'icon'] as const;
      for (const key of editable) {
        if (updates[key] !== undefined) fields[key] = updates[key];
      }

      if (Object.keys(fields).length > 0) {
        await window.electronAPI.db.projects.update(id, fields);

        await loadProjects();

        // Update current project if it's the one being updated
        if (currentProject?.id === id) {
          await loadProject(id);
        }
      }
    } catch (err) {
      console.error('Failed to update project:', err);
      throw new Error('Failed to update project');
    }
  };

  // Delete a project
  const deleteProject = async (id: string) => {
    try {
      await window.electronAPI.db.projects.remove(id);
      await loadProjects();
      
      if (currentProject?.id === id) {
        setCurrentProject(null);
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
      throw new Error('Failed to delete project');
    }
  };

  // Archive a project
  const archiveProject = async (id: string) => {
    try {
      await window.electronAPI.db.projects.archive(id);
      await loadProjects();
      
      if (currentProject?.id === id) {
        setCurrentProject(null);
      }
    } catch (err) {
      console.error('Failed to archive project:', err);
      throw new Error('Failed to archive project');
    }
  };

  // Load a specific project
  const loadProject = async (id: string) => {
    try {
      const project = await window.electronAPI.db.projectTranscripts.getProjectWithStats(id);

      if (project) {
        const projectWithMetadata = {
          ...project,
          themes: project.themes ? JSON.parse(project.themes) : [],
          key_insights: project.key_insights ? JSON.parse(project.key_insights) : [],
          tags: project.tags ? JSON.parse(project.tags) : [],
          date_range: project.earliest_transcript && project.latest_transcript ? {
            start: project.earliest_transcript,
            end: project.latest_transcript
          } : undefined
        };
        
        setCurrentProject(projectWithMetadata);
      }
    } catch (err) {
      console.error('Failed to load project:', err);
      throw new Error('Failed to load project');
    }
  };

  // Add transcript to project
  const addTranscriptToProject = async (projectId: string, transcriptId: string) => {
    try {
      await window.electronAPI.db.projectTranscripts.link(projectId, transcriptId);

      // Refresh project data
      if (currentProject?.id === projectId) {
        await loadProject(projectId);
      }
      await loadProjects();
    } catch (err) {
      console.error('Failed to add transcript to project:', err);
      throw new Error('Failed to add transcript to project');
    }
  };

  // Remove transcript from project
  const removeTranscriptFromProject = async (projectId: string, transcriptId: string) => {
    try {
      await window.electronAPI.db.projectTranscripts.unlink(projectId, transcriptId);

      // Refresh project data
      if (currentProject?.id === projectId) {
        await loadProject(projectId);
      }
      await loadProjects();
    } catch (err) {
      console.error('Failed to remove transcript from project:', err);
      throw new Error('Failed to remove transcript from project');
    }
  };

  // Get all transcripts for a project
  const getProjectTranscripts = async (projectId: string): Promise<Transcript[]> => {
    try {
      const result = await window.electronAPI.db.projectTranscripts.listTranscriptsForProject(
        projectId,
        { includeDeleted: true, orderBy: 'added_desc' }
      );

      return result.map(hydrateTranscriptRow);
    } catch (err) {
      console.error('Failed to get project transcripts:', err);
      throw new Error('Failed to get project transcripts');
    }
  };

  // Analyze project using comprehensive analysis service
  const analyzeProject = async (projectId: string) => {
    try {
      console.log('Starting project analysis...');
      
      // Perform comprehensive analysis
      const analysisResult = await projectAnalysisService.analyzeProject(projectId);
      
      // Update project with analysis results
      await window.electronAPI.db.projects.update(projectId, {
        themes: analysisResult.aggregatedThemes?.map(t => t.theme) || [],
        key_insights: analysisResult.consensusInsights || [],
        summary: analysisResult.combinedSummary,
        last_analysis_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      
      // Store detailed analysis results
      const analysisId = generateId();
      await window.electronAPI.db.projectAnalysis.insert({
        id: analysisId,
        projectId,
        analysisType: 'comprehensive_analysis',
        results: analysisResult,
        createdAt: new Date().toISOString(),
      });
      
      console.log('Project analysis completed successfully');
      
      await loadProject(projectId);
      await loadProjects();
    } catch (err) {
      console.error('Failed to analyze project:', err);
      throw new Error('Failed to analyze project');
    }
  };

  return (
    <ProjectContext.Provider value={{
      projects,
      currentProject,
      isLoading,
      error,
      createProject,
      updateProject,
      deleteProject,
      archiveProject,
      loadProject,
      addTranscriptToProject,
      removeTranscriptFromProject,
      getProjectTranscripts,
      analyzeProject,
      refreshProjects: loadProjects
    }}>
      {children}
    </ProjectContext.Provider>
  );
};