
import React, { useState } from 'react';
import { NAV_ITEMS } from '../constants';
import { UserRole } from '../types';
import { ShieldCheck, User as UserIcon, LogOut, ChevronDown } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: { name: string; id: string; role: UserRole };
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  activeTab, 
  setActiveTab, 
  currentUser, 
  onLogout
}) => {
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
  const [adminPanelExpanded, setAdminPanelExpanded] = useState(true);

  const visibleItems = NAV_ITEMS.filter((item: any) => !Array.isArray(item.roles) || item.roles.includes(currentUser.role));
  const workspaceItems = visibleItems.filter((item: any) => item.panel === 'workspace');
  const adminItems = visibleItems.filter((item: any) => item.panel === 'admin-auditor');

  const renderNavButton = (item: any) => {
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        onClick={() => setActiveTab(item.id)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium ${
          isActive
            ? 'bg-blue-600 text-white'
            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
        }`}
      >
        {item.icon}
        {item.label}
      </button>
    );
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col">
        <div className="p-6 flex items-center gap-3 border-b border-slate-800">
          <div className="bg-blue-600 p-2 rounded-lg">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">AccessGuard</h1>
        </div>

        <nav className="flex-1 mt-6 px-4 space-y-4 overflow-y-auto">
          {adminItems.length > 0 && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setAdminPanelExpanded(prev => !prev)}
                className="w-full flex items-center justify-between px-3 text-[10px] font-bold tracking-widest uppercase text-slate-500 hover:text-slate-300"
              >
                <span>Admin / Auditor Panel</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${adminPanelExpanded ? '' : '-rotate-90'}`} />
              </button>
              {adminPanelExpanded && adminItems.map(renderNavButton)}
            </div>
          )}

          {workspaceItems.length > 0 && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setWorkspaceExpanded(prev => !prev)}
                className="w-full flex items-center justify-between px-3 text-[10px] font-bold tracking-widest uppercase text-slate-500 hover:text-slate-300"
              >
                <span>My Workspace</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${workspaceExpanded ? '' : '-rotate-90'}`} />
              </button>
              {workspaceExpanded && workspaceItems.map(renderNavButton)}
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-xl mb-4">
            <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center">
              <UserIcon className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-xs font-semibold truncate">{currentUser.name}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">{currentUser.role}</p>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="w-full text-center text-xs font-bold bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 py-2 rounded-lg transition-colors"
          >
            <span className="inline-flex items-center gap-1.5">
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
          <h2 className="text-lg font-semibold text-slate-800 capitalize">
            {NAV_ITEMS.find(n => n.id === activeTab)?.label || 'Overview'}
          </h2>
          <div className="flex items-center gap-4">
             <div className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-100">
               Environment: Development
             </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
