import type { ReactNode } from "react";

interface PageHeaderProps {
  icon?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({ icon, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-left">
        {icon && (
          <span className="material-symbols-outlined page-header-icon">{icon}</span>
        )}
        <div className="page-header-text">
          <h1 className="page-header-title">{title}</h1>
          {subtitle && <span className="page-header-sub">{subtitle}</span>}
        </div>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
