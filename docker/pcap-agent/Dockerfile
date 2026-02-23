FROM alpine:3.21
RUN apk add --no-cache tcpdump && rm -rf /var/cache/apk/*
USER nobody
ENTRYPOINT ["tcpdump"]
