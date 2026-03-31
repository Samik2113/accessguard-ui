import React from 'react';

interface ModalShellProps {
  children: React.ReactNode;
  overlayClassName?: string;
  panelClassName?: string;
}

const joinClasses = (...values: Array<string | undefined | null | false>) => values.filter(Boolean).join(' ');

const ModalShell: React.FC<ModalShellProps> = ({ children, overlayClassName, panelClassName }) => {
  return (
    <div
      className={joinClasses(
        'fixed inset-0 flex items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-sm',
        overlayClassName
      )}
    >
      <div
        className={joinClasses(
          'bg-white rounded-3xl w-full max-h-[85vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 my-auto',
          panelClassName
        )}
      >
        {children}
      </div>
    </div>
  );
};

export default ModalShell;