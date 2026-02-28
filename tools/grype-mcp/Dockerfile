# syntax=docker/dockerfile:1
# Build stage — install dependencies and grype binary
FROM dhi.io/python:3.13-debian13-dev AS builder

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Runtime stage — minimal DHI image
FROM dhi.io/python:3.13-debian13 AS runtime

# Copy tini from builder (installed as part of base or we get it separately)
COPY --from=builder /usr/local/bin/grype /usr/local/bin/grype
COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY server.py .

RUN useradd -r -s /bin/false -d /nonexistent appuser

EXPOSE 8000
USER appuser
CMD ["python", "server.py"]
