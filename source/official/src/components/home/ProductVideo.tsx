import { useEffect, useId, useRef, useState } from "react";
import { Play, RotateCcw, MonitorPlay } from "lucide-react";
import "./ProductVideo.css";

type PlaybackState = "ready" | "loading" | "playing" | "paused" | "ended" | "error";

interface ProductVideoProps {
  src: string;
  poster?: string;
}

export default function ProductVideo({ src, poster }: ProductVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const moveFocusRef = useRef(false);
  const descriptionId = useId();
  const [state, setState] = useState<PlaybackState>("ready");
  const [started, setStarted] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [posterFailed, setPosterFailed] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);
  const covered = !started || state === "ended" || state === "error";
  const loading = state === "loading";

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setSlow(false);
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const startPlayback = async (reload = false) => {
    const video = videoRef.current;
    if (!video) return;
    moveFocusRef.current = document.activeElement === buttonRef.current;
    if (covered) setStarted(false);
    setError("");
    setState("loading");
    if (reload || video.error) video.load();
    else if (video.ended) video.currentTime = 0;
    try {
      // This call stays inside the click gesture so mobile browsers can play sound.
      await video.play();
    } catch (playError) {
      if (!mountedRef.current) return;
      const blocked = playError instanceof DOMException && playError.name === "NotAllowedError";
      setError(blocked ? "浏览器暂未允许播放，请再轻点一次播放按钮。" : "视频暂时无法播放，请重试，或使用浏览器打开此页面。");
      setState("error");
    }
  };

  const label = state === "error"
    ? "重试播放逛道宝产品演示视频"
    : state === "ended" ? "重新播放逛道宝产品演示视频" : "播放逛道宝产品演示视频";
  const status = state === "error" ? error
    : loading ? (slow ? "加载较慢，可以稍等或重新加载。" : "正在加载视频…")
    : state === "playing" ? "正在播放 · 可暂停或全屏观看"
    : state === "paused" ? "已暂停，可通过播放控件继续观看。"
    : state === "ended" ? "已播放完，可以再次观看。"
    : "轻点播放，可暂停或全屏观看。";

  return (
    <figure className="product-video" aria-label="产品演示视频播放器">
      <div className="product-video-frame" style={{ aspectRatio: ratio }} data-playback={state}>
        <video
          ref={videoRef}
          src={src}
          poster={poster || undefined}
          controls={!covered}
          playsInline
          preload="metadata"
          tabIndex={covered ? -1 : 0}
          aria-label="逛道宝产品演示视频"
          aria-describedby={descriptionId}
          onLoadedMetadata={() => {
            const video = videoRef.current;
            if (video && video.videoWidth > 0 && video.videoHeight > 0) {
              setRatio(video.videoWidth / video.videoHeight);
            }
          }}
          onPlaying={() => {
            setStarted(true);
            setState("playing");
            if (moveFocusRef.current) {
              videoRef.current?.focus({ preventScroll: true });
              moveFocusRef.current = false;
            }
          }}
          onWaiting={() => setState("loading")}
          onPause={() => {
            if (videoRef.current && !videoRef.current.ended && !videoRef.current.error) setState("paused");
          }}
          onEnded={() => setState("ended")}
          onError={() => {
            setError("视频暂时无法加载，请检查网络后重试。");
            setState("error");
          }}
        >
          浏览器无法播放视频，请使用支持 MP4 的浏览器观看。
        </video>
        <div className={`product-video-cover${covered ? " is-visible" : ""}`} aria-hidden={!covered}>
          {poster && !posterFailed && <img src={poster} alt="" className="product-video-poster" decoding="async" onError={() => setPosterFailed(true)} />}
          <div className="product-video-shade" aria-hidden="true" />
          <button
            ref={buttonRef}
            type="button"
            className="product-video-play"
            aria-label={label}
            aria-describedby={descriptionId}
            tabIndex={covered ? 0 : -1}
            disabled={loading}
            onClick={() => void startPlayback(state === "error")}
          >
            <span className="product-video-play-disc" aria-hidden="true">
              {loading ? <span className="product-video-spinner" /> : state === "ended" || state === "error" ? <RotateCcw /> : <Play />}
            </span>
            <span>{loading ? "正在加载" : state === "error" ? "重试播放" : state === "ended" ? "再看一次" : "播放产品演示"}</span>
          </button>
        </div>
        {loading && !covered && <div className="product-video-buffering" aria-hidden="true"><span className="product-video-spinner" /></div>}
      </div>
      <figcaption className="product-video-caption" id={descriptionId}>
        <span className="product-video-status" role="status" aria-live="polite"><MonitorPlay aria-hidden="true" />{status}</span>
        {slow && loading && <button type="button" className="product-video-reload" onClick={() => void startPlayback(true)}>重新加载</button>}
      </figcaption>
    </figure>
  );
}
