import type { ReactNode } from "react";

interface ScreenHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** 大屏页面标题区：眉标 + 主标题 + 说明 + 右侧操作 */
export default function ScreenHeader({ eyebrow, title, subtitle, actions }: ScreenHeaderProps) {
  return (
    <header className="screen-header">
      <div key={title} className="workspace-title-in">
        {eyebrow && <div className="workspace-eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="screen-header-actions">{actions}</div>}
    </header>
  );
}
