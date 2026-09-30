use super::{
    artifacts::{Asset, cancelled},
    *,
};
use std::{fs::File, io::Write, time::Duration};

pub(super) fn download(path: &Path, asset: &Asset, cancel: &AtomicBool) -> Result<(), String> {
    let mut url = reqwest::Url::parse(asset.url.as_deref().ok_or(INVALID)?).map_err(|_| INVALID)?;
    for _ in 0..6 {
        cancelled(cancel)?;
        let host = url.host_str().ok_or(INVALID)?;
        let allowed = [
            "github.com",
            "release-assets.githubusercontent.com",
            "huggingface.co",
            "cdn-lfs.huggingface.co",
            "cdn-lfs-us-1.huggingface.co",
            "cas-bridge.xethub.hf.co",
        ];
        if url.scheme() != "https"
            || !allowed.contains(&host)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port_or_known_default() != Some(443)
        {
            return Err("BLK-LOCAL-MODEL-SOURCE".into());
        }
        let addresses = crate::network_policy::resolve(host, 443, &|| cancelled(cancel))?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(host, &addresses)
            .timeout(Duration::from_secs(600))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| IO)?;
        match transfer(client, url, path, asset, cancel)? {
            Some(next) => url = next,
            None => {
                drop(artifacts::open_asset(path, asset, cancel)?);
                return Ok(());
            }
        }
    }
    Err("BLK-LOCAL-MODEL-SOURCE".into())
}
fn transfer(
    client: reqwest::Client,
    url: reqwest::Url,
    path: &Path,
    asset: &Asset,
    cancel: &AtomicBool,
) -> Result<Option<reqwest::Url>, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| IO)?;
    runtime.block_on(async {
        let interrupted=async {loop {if cancel.load(Ordering::SeqCst){break;}tokio::time::sleep(Duration::from_millis(20)).await;}};
        tokio::select! {
            biased;
            _=interrupted=>Err("BLK-LOCAL-MODEL-CANCELLED".into()),
            result=async {
                let mut response=client.get(url.clone()).send().await.map_err(|_|"BLK-LOCAL-MODEL-DOWNLOAD")?;
                if response.status().is_redirection() {
                    let location=response.headers().get(reqwest::header::LOCATION).and_then(|v|v.to_str().ok()).ok_or("BLK-LOCAL-MODEL-SOURCE")?;
                    return Ok(Some(url.join(location).map_err(|_|"BLK-LOCAL-MODEL-SOURCE")?));
                }
                if !response.status().is_success()||response.content_length().is_some_and(|n|n!=asset.bytes) {return Err("BLK-LOCAL-MODEL-DOWNLOAD".into());}
                let mut output=File::create(path).map_err(|_|IO)?;let mut count=0;
                while let Some(chunk)=response.chunk().await.map_err(|_|"BLK-LOCAL-MODEL-DOWNLOAD")? {
                    cancelled(cancel)?;count+=chunk.len() as u64;
                    if count>asset.bytes{return Err("BLK-LOCAL-MODEL-HASH".into());}
                    output.write_all(&chunk).map_err(|_|IO)?;
                }
                output.sync_all().map_err(|_|IO)?;Ok(None)
            }=>result,
        }
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_closes_a_stalled_download_connection() {
        use std::{
            io::Read,
            net::TcpListener,
            sync::{Arc, mpsc},
            time::Instant,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (ready_rx, ready) = mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut b = [0u8; 8192];
            assert!(socket.read(&mut b).unwrap() > 0);
            ready_rx.send(()).unwrap();
            assert_eq!(socket.read(&mut b).unwrap(), 0);
        });
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        let interrupter = std::thread::spawn(move || {
            ready.recv_timeout(Duration::from_secs(2)).unwrap();
            c.store(true, Ordering::SeqCst);
        });
        let root = super::super::tests::root();
        let began = Instant::now();
        let asset = Asset {
            name: "test".into(),
            bytes: 1,
            sha256: "".into(),
            url: None,
        };
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert_eq!(
            transfer(
                client,
                format!("http://{addr}").parse().unwrap(),
                &root.path().join("partial"),
                &asset,
                &cancel
            )
            .unwrap_err(),
            "BLK-LOCAL-MODEL-CANCELLED"
        );
        assert!(began.elapsed() < Duration::from_secs(1));
        interrupter.join().unwrap();
        server.join().unwrap();
    }
}
