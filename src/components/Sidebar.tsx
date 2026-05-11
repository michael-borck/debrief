import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, FolderOpen, Library, Settings, ChevronLeft, ChevronRight, Info, Upload, Search, Trash, Archive, MessageCircle, BookOpen, Keyboard, HelpCircle } from 'lucide-react';
import packageJson from '../../package.json';

const APP_VERSION = packageJson.version;

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: (collapsed: boolean) => void;
  onAboutClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, onToggleCollapse, onAboutClick }) => {
  const location = useLocation();

  const menuItems = [
    { path: '/', icon: Home, label: 'Dashboard' },
    { path: '/upload', icon: Upload, label: 'Upload & Process' },
    { path: '/projects', icon: FolderOpen, label: 'Projects' },
    { path: '/library', icon: Library, label: 'Library' },
    { path: '/settings', icon: Settings, label: 'Settings' },
  ];

  const dataItems = [
    { path: '/search', icon: Search, label: 'Search & Filter' },
    { path: '/chat-history', icon: MessageCircle, label: 'Chat History' },
    { path: '/trash', icon: Trash, label: 'Trash' },
    { path: '/archive', icon: Archive, label: 'Archive' },
  ];

  const helpItems = [
    { path: '/docs', icon: BookOpen, label: 'Documentation' },
    { path: '/shortcuts', icon: Keyboard, label: 'Keyboard Shortcuts' },
    { path: '/docs/troubleshooting/common-issues', icon: HelpCircle, label: 'Help & Support' },
  ];

  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true;
    if (path !== '/' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <div className={`bg-[#2d3436] text-white h-full transition-all duration-300 ease-out ${
      isCollapsed ? 'w-16' : 'w-64'
    } flex flex-col`}>
      {/* Logo/Brand */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-lg bg-accent-300/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            {!isCollapsed && <span className="ml-3 text-xl font-display font-bold text-primary-100 tracking-tight">Debrief</span>}
          </div>
          <button
            onClick={() => onToggleCollapse(!isCollapsed)}
            className={`p-1.5 hover:bg-white/10 rounded-lg transition-colors ${isCollapsed ? 'mx-auto mt-2' : ''}`}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 p-3 space-y-6 overflow-y-auto">
        {/* Main Navigation */}
        <div>
          {!isCollapsed && <h3 className="text-[10px] font-sans font-semibold text-[#6b6358] uppercase tracking-widest mb-2 px-3">Navigation</h3>}
          <ul className="space-y-0.5">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center px-3 py-2 rounded-lg transition-all duration-200 ${
                      isActive(item.path)
                        ? 'bg-accent-300/15 text-primary-100 border-l-2 border-accent-300'
                        : 'hover:bg-white/5 text-[#a09585] hover:text-primary-100'
                    }`}
                    title={isCollapsed ? item.label : ''}
                  >
                    <Icon size={18} className={isCollapsed ? 'mx-auto' : ''} strokeWidth={isActive(item.path) ? 2.5 : 1.5} />
                    {!isCollapsed && <span className="ml-3 text-sm font-sans">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Data Management */}
        <div>
          {!isCollapsed && <h3 className="text-[10px] font-sans font-semibold text-[#6b6358] uppercase tracking-widest mb-2 px-3">Data</h3>}
          <ul className="space-y-0.5">
            {dataItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center px-3 py-2 rounded-lg transition-all duration-200 ${
                      isActive(item.path)
                        ? 'bg-accent-300/15 text-primary-100 border-l-2 border-accent-300'
                        : 'hover:bg-white/5 text-[#a09585] hover:text-primary-100'
                    }`}
                    title={isCollapsed ? item.label : ''}
                  >
                    <Icon size={18} className={isCollapsed ? 'mx-auto' : ''} strokeWidth={isActive(item.path) ? 2.5 : 1.5} />
                    {!isCollapsed && <span className="ml-3 text-sm font-sans">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Help & Documentation */}
        <div>
          {!isCollapsed && <h3 className="text-[10px] font-sans font-semibold text-[#6b6358] uppercase tracking-widest mb-2 px-3">Help</h3>}
          <ul className="space-y-0.5">
            {helpItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center px-3 py-2 rounded-lg transition-all duration-200 ${
                      isActive(item.path)
                        ? 'bg-accent-300/15 text-primary-100 border-l-2 border-accent-300'
                        : 'hover:bg-white/5 text-[#a09585] hover:text-primary-100'
                    }`}
                    title={isCollapsed ? item.label : ''}
                  >
                    <Icon size={18} className={isCollapsed ? 'mx-auto' : ''} strokeWidth={isActive(item.path) ? 2.5 : 1.5} />
                    {!isCollapsed && <span className="ml-3 text-sm font-sans">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Bottom section - version info */}
      <div className="p-4 border-t border-white/10">
        {!isCollapsed ? (
          <div className="text-xs font-sans">
            <button
              onClick={onAboutClick}
              className="text-[#a09585] hover:text-primary-100 transition-colors flex items-center space-x-1.5"
            >
              <Info size={13} />
              <span>Debrief v{APP_VERSION}</span>
            </button>
            <p className="text-[#6b6358] mt-1">&copy; {new Date().getFullYear()}</p>
          </div>
        ) : (
          <button
            onClick={onAboutClick}
            title="About Debrief"
            className="p-2 hover:bg-white/10 rounded-lg transition-colors mx-auto block"
          >
            <Info size={15} className="text-[#a09585] hover:text-primary-100" />
          </button>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
