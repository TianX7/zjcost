import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  icon?: string;
  extra?: ReactNode;
  live?: boolean;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
  children: ReactNode;
}

/** 大屏统一玻璃面板：标题栏 + 可选 LIVE 徽标 + 四角装饰 */
export default function Panel({
  title,
  icon,
  extra,
  live,
  className,
  bodyClassName,
  flush,
  children,
}: PanelProps) {
  const panelClass = `screen-panel${className ? ` ${className}` : ""}`;
  const bodyClass = `screen-panel-body${flush ? " flush" : ""}${bodyClassName ? ` ${bodyClassName}` : ""}`;

  return (
    <section className={panelClass}>
      <div className="screen-panel-head">
        <div className="screen-panel-title">
          {icon && <span className="material-symbols-outlined">{icon}</span>}
          <span>{title}</span>
        </div>
        <div className="screen-panel-extra">
          {live && (
            <span className="screen-panel-live">
              <span className="screen-panel-live-dot" />
              LIVE
            </span>
          )}
          {extra}
        </div>
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}
