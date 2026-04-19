FROM rust:1.93-bookworm AS builder
WORKDIR /app
COPY . .
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN useradd --system --user-group --create-home theboss
COPY --from=builder /app/target/release/the-boss-control-plane /usr/local/bin/the-boss-control-plane
USER theboss
ENV THE_BOSS_BIND_ADDR=0.0.0.0:8787
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/the-boss-control-plane"]
