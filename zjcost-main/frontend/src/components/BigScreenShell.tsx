import type { ReactNode } from "react";

interface BigScreenShellProps {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** 大屏页面壳：可滚动主体 + 可选底部状态条 */
export default function BigScreenShell({ children, footer, className }: BigScreenShellProps) {
  return (
    <div className={`screen-shell${className ? ` ${className}` : ""}`}>
      <div className="screen-shell-body">{children}</div>
      {footer && <div className="screen-footer">{footer}</div>}
    </div>
  );
}
