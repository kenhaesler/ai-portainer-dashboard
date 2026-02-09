# syntax=docker/dockerfile:1
# Build stage — install Python dependencies
FROM dhi.io/python:3.13-debian13-dev AS builder

WORKDIR /app

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Runtime stage — minimal DHI image
FROM dhi.io/python:3.13-debian13 AS runtime

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY server.py .

EXPOSE 8000
CMD ["python", "server.py"]
