use std::{net::SocketAddr, sync::Arc};

use anyhow::Context;
use the_boss_control_plane::{
    app,
    config::{BootstrapConfig, ConfigStore, PgConfigStore},
    AppState,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = BootstrapConfig::from_cli_env()?;
    let bind_addr: SocketAddr = config
        .bind_addr
        .parse()
        .with_context(|| format!("invalid bind address: {}", config.bind_addr))?;
    let state = if let Some(database_url) = &config.database_url {
        let pg_store = PgConfigStore::connect(database_url).await?;
        let db_config = pg_store.load_or_seed_async(config.clone()).await?;
        let store: Arc<dyn ConfigStore> = Arc::new(pg_store);
        Arc::new(AppState::new_with_config_store(db_config, store))
    } else {
        Arc::new(AppState::new(config))
    };
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;

    tracing::info!(%bind_addr, "starting The Boss control plane");
    axum::serve(listener, app(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}
