# 构建阶段
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# 运行阶段
FROM python:3.12-slim
WORKDIR /app

# 创建非 root 用户
RUN useradd -m -u 1000 appuser

# 复制依赖
COPY --from=builder /root/.local /home/appuser/.local
COPY --chown=appuser:appuser . .

# 设置环境变量
ENV PATH=/home/appuser/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV ZJCOST_ENV=production

# 切换非 root 用户
USER appuser

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
