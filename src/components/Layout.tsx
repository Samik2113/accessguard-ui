
import React, { useState } from 'react';
import { HR_SCHEMA_FIELDS, NAV_ITEMS } from '../constants';
import { AppCustomization, UserRole } from '../types';
import { ShieldCheck, User as UserIcon, LogOut, ChevronDown, Settings, X } from 'lucide-react';
import ModalShell from './ModalShell';

const getOnPrimaryTextColor = (input: string, fallback = '#2563eb') => {
  const value = String(input || '').trim();
  const hex = /^#([0-9a-fA-F]{6})$/.test(value) ? value : fallback;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#0f172a' : '#ffffff';
};

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: { name: string; id: string; role: UserRole };
  onLogout: () => void;
  customization: AppCustomization;
  onSaveCustomization: (next: AppCustomization) => void;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  activeTab, 
  setActiveTab, 
  currentUser, 
  onLogout,
  customization,
  onSaveCustomization
}) => {
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
  const [adminPanelExpanded, setAdminPanelExpanded] = useState(true);
  const [showCustomization, setShowCustomization] = useState(false);
  const [draftCustomization, setDraftCustomization] = useState<AppCustomization>(customization);

  const templateFields = [
    { key: 'reviewAssignment', label: 'Review Assignment Email' },
    { key: 'reviewReminder', label: 'Review Reminder Email' },
    { key: 'reviewEscalation', label: 'Escalation Email' },
    { key: 'reviewConfirmationReminder', label: 'Confirmation Reminder Email' },
    { key: 'reviewConfirmationEscalation', label: 'Confirmation Escalation Email' },
    { key: 'remediationNotify', label: 'Remediation Notification Email' },
    { key: 'reviewReassigned', label: 'Reassigned Item Email' },
    { key: 'reviewReassignedBulk', label: 'Bulk Reassigned Items Email' }
  ] as const;

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
            ? 'text-white'
            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
        }`}
        style={isActive ? { backgroundColor: customization.primaryColor, color: getOnPrimaryTextColor(customization.primaryColor) } : undefined}
      >
        {item.icon}
        {item.label}
      </button>
    );
  };

  const openCustomization = () => {
    if (currentUser.role !== UserRole.ADMIN) return;
    setDraftCustomization(customization);
    setShowCustomization(true);
  };

  const saveCustomization = () => {
    if (currentUser.role !== UserRole.ADMIN) return;
    onSaveCustomization(draftCustomization);
    setShowCustomization(false);
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col">
        <div className="p-6 flex items-center gap-3 border-b border-slate-800">
          <div className="p-2 rounded-lg" style={{ backgroundColor: customization.primaryColor }}>
            <ShieldCheck className="w-6 h-6" style={{ color: getOnPrimaryTextColor(customization.primaryColor) }} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">{customization.platformName}</h1>
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
              {customization.supportEmail && (
                <p className="text-[10px] text-slate-500 truncate">{customization.supportEmail}</p>
              )}
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
             <div
               className="px-3 py-1 text-xs font-medium rounded-full border"
               style={{ borderColor: customization.primaryColor, color: customization.primaryColor, backgroundColor: `${customization.primaryColor}12` }}
             >
               Environment: {customization.environmentLabel}
             </div>
             {currentUser.role === UserRole.ADMIN && (
               <button
                 type="button"
                 onClick={openCustomization}
                 className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
               >
                 <Settings className="w-3.5 h-3.5" /> Customize
               </button>
             )}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </main>

      {showCustomization && currentUser.role === UserRole.ADMIN && (
        <ModalShell overlayClassName="z-[120]" panelClassName="max-w-4xl max-h-[90vh] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Customize Platform</h3>
              <button onClick={() => setShowCustomization(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Platform Name</label>
              <input
                type="text"
                value={draftCustomization.platformName}
                onChange={(event) => setDraftCustomization(prev => ({ ...prev, platformName: event.target.value }))}
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Primary Color Code</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={draftCustomization.primaryColor}
                  onChange={(event) => setDraftCustomization(prev => ({ ...prev, primaryColor: event.target.value }))}
                  className="h-10 w-12 border border-slate-300 rounded"
                />
                <input
                  type="text"
                  value={draftCustomization.primaryColor}
                  onChange={(event) => setDraftCustomization(prev => ({ ...prev, primaryColor: event.target.value }))}
                  placeholder="#2563eb"
                  className="flex-1 px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Environment Label</label>
              <input
                type="text"
                value={draftCustomization.environmentLabel}
                onChange={(event) => setDraftCustomization(prev => ({ ...prev, environmentLabel: event.target.value }))}
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Login Subtitle</label>
              <input
                type="text"
                value={draftCustomization.loginSubtitle}
                onChange={(event) => setDraftCustomization(prev => ({ ...prev, loginSubtitle: event.target.value }))}
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Idle Timeout (minutes)</label>
              <input
                type="number"
                min={5}
                max={1440}
                value={draftCustomization.idleTimeoutMinutes}
                onChange={(event) => setDraftCustomization(prev => ({ ...prev, idleTimeoutMinutes: Number(event.target.value || 0) }))}
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
              <p className="mt-1 text-[11px] text-slate-500">Allowed range: 5 to 1440 minutes.</p>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Support Email (optional)</label>
              <input
                type="email"
                value={draftCustomization.supportEmail}
                onChange={(event) => setDraftCustomization(prev => ({ ...prev, supportEmail: event.target.value }))}
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div className="pt-2 border-t border-slate-200 space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-700">HR Feed Schema</h4>
                <p className="mt-1 text-[11px] text-slate-500">Configure client-specific HR column names. These mappings are used when you upload HR identities from Inventory.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {HR_SCHEMA_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{field.label}{field.required ? ' *' : ''}</label>
                    <input
                      type="text"
                      value={draftCustomization.hrFeedSchema?.mappings?.[field.key] || ''}
                      onChange={(event) => setDraftCustomization((prev) => ({
                        ...prev,
                        hrFeedSchema: {
                          ...prev.hrFeedSchema!,
                          mappings: {
                            ...prev.hrFeedSchema!.mappings,
                            [field.key]: event.target.value
                          }
                        }
                      }))}
                      className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                      placeholder={field.label}
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Extra Columns To Preserve</label>
                  <textarea
                    value={(draftCustomization.hrFeedSchema?.customColumns || []).join(', ')}
                    onChange={(event) => setDraftCustomization((prev) => ({
                      ...prev,
                      hrFeedSchema: {
                        ...prev.hrFeedSchema!,
                        customColumns: event.target.value.split(',').map((value) => value.trim()).filter(Boolean)
                      }
                    }))}
                    rows={3}
                    className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                    placeholder="City, Manager details, Last logon date"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Ignore Columns</label>
                  <textarea
                    value={(draftCustomization.hrFeedSchema?.ignoreColumns || []).join(', ')}
                    onChange={(event) => setDraftCustomization((prev) => ({
                      ...prev,
                      hrFeedSchema: {
                        ...prev.hrFeedSchema!,
                        ignoreColumns: event.target.value.split(',').map((value) => value.trim()).filter(Boolean)
                      }
                    }))}
                    rows={3}
                    className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                    placeholder="Description"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Active Status Values</label>
                  <textarea
                    value={(draftCustomization.hrFeedSchema?.statusRules?.activeValues || []).join(', ')}
                    onChange={(event) => setDraftCustomization((prev) => ({
                      ...prev,
                      hrFeedSchema: {
                        ...prev.hrFeedSchema!,
                        statusRules: {
                          ...prev.hrFeedSchema!.statusRules,
                          activeValues: event.target.value.split(',').map((value) => value.trim()).filter(Boolean)
                        }
                      }
                    }))}
                    rows={3}
                    className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Inactive Status Values</label>
                  <textarea
                    value={(draftCustomization.hrFeedSchema?.statusRules?.inactiveValues || []).join(', ')}
                    onChange={(event) => setDraftCustomization((prev) => ({
                      ...prev,
                      hrFeedSchema: {
                        ...prev.hrFeedSchema!,
                        statusRules: {
                          ...prev.hrFeedSchema!.statusRules,
                          inactiveValues: event.target.value.split(',').map((value) => value.trim()).filter(Boolean)
                        }
                      }
                    }))}
                    rows={3}
                    className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200">
              <h4 className="text-sm font-bold text-slate-700">Email Templates</h4>
              <p className="mt-1 text-[11px] text-slate-500">
                Use placeholders like {'{{reviewerName}}'} or {'{{pendingCount}}'}. Line breaks are preserved and links such as https://... become clickable.
              </p>
              <div className="mt-3 space-y-4">
                {templateFields.map((field) => (
                  <div key={field.key} className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{field.label}</p>
                    <div>
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Subject</label>
                      <input
                        type="text"
                        value={draftCustomization.emailTemplates[field.key].subject}
                        onChange={(event) => setDraftCustomization(prev => ({
                          ...prev,
                          emailTemplates: {
                            ...prev.emailTemplates,
                            [field.key]: {
                              ...prev.emailTemplates[field.key],
                              subject: event.target.value
                            }
                          }
                        }))}
                        className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Body</label>
                      <textarea
                        value={draftCustomization.emailTemplates[field.key].body}
                        onChange={(event) => setDraftCustomization(prev => ({
                          ...prev,
                          emailTemplates: {
                            ...prev.emailTemplates,
                            [field.key]: {
                              ...prev.emailTemplates[field.key],
                              body: event.target.value
                            }
                          }
                        }))}
                        rows={6}
                        className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => setShowCustomization(false)} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50">Cancel</button>
              <button
                onClick={saveCustomization}
                className="px-4 py-2 text-white rounded-lg text-sm font-semibold"
                style={{
                  backgroundColor: draftCustomization.primaryColor || '#2563eb',
                  color: getOnPrimaryTextColor(draftCustomization.primaryColor || '#2563eb')
                }}
              >
                Save
              </button>
            </div>
        </ModalShell>
      )}
    </div>
  );
};

export default Layout;
