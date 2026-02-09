FROM dhi.io/python:3.13-debian13-dev

RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates curl \
    && curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["python", "server.py"]
