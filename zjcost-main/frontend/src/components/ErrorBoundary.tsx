import { Component, type ErrorInfo, type ReactNode } from "react";
import { message } from "antd";

interface Props {
  children: ReactNode;
  /** 降级提示标题，默认"应用出现异常" */
  title?: string;
  /** 内联模式：只降级这块区域（如 3D 视图），不占满整页 */
  inline?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleCopyError = () => {
    const text = this.state.error?.stack || this.state.error?.message || "";
    navigator.clipboard.writeText(text).then(() => {
      message.success("错误信息已复制");
    }).catch(() => {
      message.error("复制失败，请手动选择文本");
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.inline) {
        return (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              minHeight: 220,
              background: "var(--bg, #0c1017)",
              color: "var(--text-secondary, #94a3b8)",
              fontFamily: "system-ui, sans-serif",
              padding: "1.5rem",
              textAlign: "center",
              gap: 8,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 36 }}>
              view_in_ar_off
            </span>
            <strong style={{ color: "var(--text-primary, #e2e8f0)" }}>
              {this.props.title || "该区域暂无法显示"}
            </strong>
            <span style={{ fontSize: 13, maxWidth: 420 }}>
              {this.state.error?.message === "Error creating WebGL context."
                ? "当前设备的浏览器无法创建 3D 渲染上下文（WebGL），其余功能不受影响。可尝试更新显卡驱动，或重装/更新 Chrome、Edge 后再试。"
                : this.state.error?.message || "未知错误"}
            </span>
          </div>
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            background: "var(--bg, #0c1017)",
            color: "var(--text-primary, #e2e8f0)",
            fontFamily: "system-ui, sans-serif",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 48, marginBottom: 16 }}>
            error_outline
          </span>
          <h2 style={{ marginBottom: 8 }}>应用出现异常</h2>
          <p style={{ color: "var(--text-secondary, #94a3b8)", marginBottom: 24, maxWidth: 480 }}>
            {this.state.error?.message || "未知错误"}
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "var(--primary, #1456b8)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "10px 24px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              重新加载应用
            </button>
            <button
              onClick={this.handleCopyError}
              style={{
                background: "transparent",
                color: "var(--text-primary, #e2e8f0)",
                border: "1px solid var(--border, #1e293b)",
                borderRadius: 8,
                padding: "10px 24px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              复制错误信息
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
