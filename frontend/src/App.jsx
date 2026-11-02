import React, { useState, useEffect, useRef } from 'react';

// Available photo niches
const ALL_NICHES = [
  { id: 'casal', label: 'Casal', defaultPrice: 450, defaultDesc: '1h de ensaio no estúdio ou parque, 20 fotos tratadas em alta resolução.' },
  { id: 'familia', label: 'Família', defaultPrice: 550, defaultDesc: '1h30 em estúdio ou externa, figurino incluso, 25 fotos tratadas.' },
  { id: 'gestante', label: 'Gestante', defaultPrice: 500, defaultDesc: 'Ensaio acolhedor com produção, tecidos e troca de looks inclusos.' },
  { id: 'formatura', label: 'Formatura', defaultPrice: 400, defaultDesc: 'Sessão individual com fotos de beca e gala, 15 fotos tratadas.' },
  { id: 'casamento', label: 'Casamento', defaultPrice: 2800, defaultDesc: 'Cobertura completa making of, cerimônia e recepção com álbum encadernado.' }
];

// ==========================================
// INTERACTIVE ANIMATED VIDEO PLAYER COMPONENT
// Plays step-by-step animated visual scenes with timer, play/pause, progress bar, and Portuguese voiceover (Web Speech API)
// ==========================================
function InteractiveTutorialVideo({ title, durationSec = 20, slides = [], autoPlay = false }) {
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [elapsed, setElapsed] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const lastSpokenIndex = useRef(-1);

  const slideDuration = durationSec / Math.max(slides.length, 1);
  const currentSlideIndex = Math.min(Math.floor(elapsed / slideDuration), slides.length - 1);
  const currentSlide = slides[currentSlideIndex] || slides[0];

  // Speak slide narration in Portuguese when slide changes
  useEffect(() => {
    if (!isPlaying) {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      return;
    }
    if (voiceEnabled && currentSlide && lastSpokenIndex.current !== currentSlideIndex) {
      lastSpokenIndex.current = currentSlideIndex;
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(currentSlide.narration || currentSlide.caption);
          utter.lang = 'pt-BR';
          utter.rate = 1.05;
          window.speechSynthesis.speak(utter);
        } catch (e) {
          // Ignore speech error on unsupported environments
        }
      }
    }
  }, [isPlaying, currentSlideIndex, voiceEnabled, currentSlide]);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  // Playback timer loop
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setElapsed(prev => {
        if (prev + 0.2 >= durationSec) {
          setIsPlaying(false);
          lastSpokenIndex.current = -1;
          return durationSec;
        }
        return prev + 0.2;
      });
    }, 200);
    return () => clearInterval(timer);
  }, [isPlaying, durationSec]);

  const handleTogglePlay = () => {
    if (elapsed >= durationSec) {
      setElapsed(0);
      lastSpokenIndex.current = -1;
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleRestart = () => {
    setElapsed(0);
    lastSpokenIndex.current = -1;
    setIsPlaying(true);
  };

  const progressPercent = Math.min((elapsed / durationSec) * 100, 100);
  const formatSec = (s) => {
    const sec = Math.floor(s);
    return `0:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <div style={{
      backgroundColor: '#0b141a',
      borderRadius: '14px',
      border: isPlaying ? '2px solid #25D366' : '1px solid var(--wa-border)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
    }}>
      {/* Video Screen Area */}
      <div
        onClick={handleTogglePlay}
        style={{
          position: 'relative',
          minHeight: '230px',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          cursor: 'pointer',
          background: 'radial-gradient(circle at center, #1a2c35 0%, #0b141a 100%)'
        }}
      >
        {/* Top bar inside video */}
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '14px',
          right: '14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '11.5px',
          color: '#8696a0'
        }}>
          <span style={{ backgroundColor: 'rgba(0,0,0,0.6)', padding: '3px 8px', borderRadius: '6px', color: '#fff', fontWeight: 'bold' }}>
            🎬 Passo {currentSlideIndex + 1} de {slides.length}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setVoiceEnabled(!voiceEnabled);
              if (window.speechSynthesis) window.speechSynthesis.cancel();
            }}
            style={{
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: voiceEnabled ? '#25D366' : '#8696a0',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11.5px'
            }}
          >
            {voiceEnabled ? '🔊 Narração Ligada' : '🔇 Sem Som'}
          </button>
        </div>

        {/* Animated Visual Scene */}
        <div style={{
          marginTop: '18px',
          marginBottom: '12px',
          padding: '16px 24px',
          borderRadius: '14px',
          backgroundColor: 'rgba(32, 44, 51, 0.9)',
          border: '2px solid rgba(37, 211, 102, 0.5)',
          transform: isPlaying ? 'scale(1.03)' : 'scale(1)',
          transition: 'all 0.35s ease',
          maxWidth: '380px',
          width: '100%'
        }}>
          <div style={{ fontSize: '42px', marginBottom: '8px' }}>
            {currentSlide?.icon || '📱'}
          </div>
          <div style={{ fontSize: '16px', fontWeight: '800', color: '#25D366', marginBottom: '6px' }}>
            {currentSlide?.headline}
          </div>
          <div style={{ fontSize: '14px', color: '#ffffff', lineHeight: '1.45' }}>
            {currentSlide?.caption}
          </div>
        </div>

        {/* Big Play Overlay when Paused */}
        {!isPlaying && (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(11, 20, 26, 0.65)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            backdropFilter: 'blur(2px)'
          }}>
            <div style={{
              width: '68px',
              height: '68px',
              borderRadius: '50%',
              backgroundColor: '#25D366',
              color: '#111b21',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '30px',
              fontWeight: 'bold',
              boxShadow: '0 6px 24px rgba(37, 211, 102, 0.6)'
            }}>
              ▶
            </div>
            <span style={{
              backgroundColor: '#111b21',
              color: '#fff',
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '13px',
              fontWeight: 'bold',
              border: '1px solid #25D366'
            }}>
              {elapsed >= durationSec ? '🔄 Assistir Novamente' : `▶ Clique para Reproduzir (${durationSec}s)`}
            </span>
          </div>
        )}
      </div>

      {/* Video Controls Bar */}
      <div style={{
        backgroundColor: '#111b21',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        borderTop: '1px solid var(--wa-border)'
      }}>
        {/* Scrubber Progress Bar */}
        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, clickX / rect.width));
            setElapsed(ratio * durationSec);
            lastSpokenIndex.current = -1;
          }}
          style={{
            width: '100%',
            height: '8px',
            backgroundColor: '#2a3942',
            borderRadius: '4px',
            cursor: 'pointer',
            overflow: 'hidden'
          }}
        >
          <div style={{
            width: `${progressPercent}%`,
            height: '100%',
            backgroundColor: '#25D366',
            transition: 'width 0.2s linear'
          }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleTogglePlay}
              style={{
                backgroundColor: '#25D366',
                color: '#111b21',
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12.5px',
                fontWeight: 'bold'
              }}
            >
              {isPlaying ? '⏸ Pausar' : (elapsed >= durationSec ? '🔄 Repetir' : '▶ Play')}
            </button>
            {elapsed > 0 && (
              <button
                type="button"
                onClick={handleRestart}
                style={{
                  backgroundColor: 'var(--wa-card)',
                  color: '#d1d7db',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '12px'
                }}
              >
                ⏮ Início
              </button>
            )}
          </div>

          <span style={{ fontSize: '12px', color: '#8696a0', fontFamily: 'monospace' }}>
            {formatSec(elapsed)} / {formatSec(durationSec)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [studioId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || params.get('token') || 'default_token_leo';
  });

  // Polyfill for <input type="checkbox" switch> when not natively supported
  useEffect(() => {
    if (typeof window !== 'undefined' && 'HTMLInputElement' in window && !('switch' in HTMLInputElement.prototype)) {
      import('input-switch-polyfill').catch(() => {});
    }
  }, []);

  // Handle browser back/forward and path changes
  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Clean Single Top Navigation Bar */}
      <header style={{
        backgroundColor: 'var(--wa-panel)',
        borderBottom: '1px solid var(--wa-border)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        flexWrap: 'wrap',
        gap: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            backgroundColor: 'var(--wa-green)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px'
          }}>📸</div>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>Bot do Studio</h1>
            <span style={{ fontSize: '11px', color: 'var(--wa-green)', fontWeight: '600' }}>Secretária Virtual</span>
          </div>
        </div>

        {/* Navigation Buttons (Zero Redundancy) */}
        <nav style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: (currentPath === '/dashboard' || currentPath === '/') ? 'bold' : 'normal',
              backgroundColor: (currentPath === '/dashboard' || currentPath === '/') ? 'var(--wa-card)' : 'transparent',
              color: (currentPath === '/dashboard' || currentPath === '/') ? 'var(--wa-green)' : 'var(--wa-muted)',
              border: (currentPath === '/dashboard' || currentPath === '/') ? '1px solid var(--wa-green)' : '1px solid transparent'
            }}
          >
            📋 Painel
          </button>
          <button
            onClick={() => navigate('/comecar')}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: (currentPath === '/comecar' || currentPath === '/instalar') ? 'bold' : 'normal',
              backgroundColor: (currentPath === '/comecar' || currentPath === '/instalar') ? 'var(--wa-card)' : 'transparent',
              color: (currentPath === '/comecar' || currentPath === '/instalar') ? 'var(--wa-green)' : 'var(--wa-muted)',
              border: (currentPath === '/comecar' || currentPath === '/instalar') ? '1px solid var(--wa-green)' : '1px solid transparent'
            }}
          >
            📲 Conectar Celular
          </button>
          <button
            onClick={() => navigate('/onboarding')}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: currentPath === '/onboarding' ? 'bold' : 'normal',
              backgroundColor: currentPath === '/onboarding' ? 'var(--wa-card)' : 'transparent',
              color: currentPath === '/onboarding' ? 'var(--wa-green)' : 'var(--wa-muted)',
              border: currentPath === '/onboarding' ? '1px solid var(--wa-green)' : '1px solid transparent'
            }}
          >
            ⚙️ Configurar Estúdio
          </button>
          <button
            onClick={() => navigate('/ajuda')}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: currentPath === '/ajuda' ? 'bold' : 'normal',
              backgroundColor: currentPath === '/ajuda' ? 'var(--wa-card)' : 'transparent',
              color: currentPath === '/ajuda' ? 'var(--wa-green)' : 'var(--wa-muted)',
              border: currentPath === '/ajuda' ? '1px solid var(--wa-green)' : '1px solid transparent'
            }}
          >
            🎥 Ajuda
          </button>
        </nav>
      </header>

      {/* Main Content View */}
      <main style={{ flex: 1, padding: '20px 16px', maxWidth: '880px', width: '100%', margin: '0 auto' }}>
        {currentPath === '/onboarding' && <OnboardingView token={studioId} onSaveSuccess={() => navigate('/dashboard')} />}
        {(currentPath === '/comecar' || currentPath === '/instalar') && (
          <OneClickInstallView
            token={studioId}
            onGoToDashboard={() => navigate('/dashboard')}
            onGoToHelp={() => navigate('/ajuda')}
          />
        )}
        {currentPath === '/ajuda' && <HelpVideosView onBack={() => navigate('/comecar')} />}
        {(currentPath === '/dashboard' || currentPath === '/') && (
          <DashboardView
            token={studioId}
            onGoToOnboarding={() => navigate('/onboarding')}
            onGoToComecar={() => navigate('/comecar')}
          />
        )}
      </main>
    </div>
  );
}

// ==========================================
// 1-CLICK INSTALL VIEW (/comecar & /instalar)
// Automatically turns the bot ON when connecting!
// ==========================================
function OneClickInstallView({ token, onGoToDashboard, onGoToHelp }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showSimpleFallback, setShowSimpleFallback] = useState(false);
  const [code1, setCode1] = useState('');
  const [code2, setCode2] = useState('');
  const [activeVideoModal, setActiveVideoModal] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [pageQrUrl, setPageQrUrl] = useState(null);
  const [waGatewayStatus, setWaGatewayStatus] = useState(null);

  const videoDialogRef = useRef(null);

  // Helper that ensures the bot is unpaused and active on the backend
  const activateBotAutomatically = async () => {
    try {
      await fetch('/api/bot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: false })
      });
    } catch (e) {
      // ignore network error
    }
  };

  // Listen for PWA install prompt
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  // Load QR code of the /comecar page + check live WhatsApp connection status
  const refreshGatewayStatus = () => {
    fetch('/api/qr_status?auto_start=1')
      .then(res => res.json())
      .then(data => {
        setWaGatewayStatus(data);
        if (data && data.status === 'CONNECTED' && showSimpleFallback) {
          activateBotAutomatically();
          setConnected(true);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    const comecarUrl = `${window.location.origin}/comecar`;
    fetch(`/api/page_qr?url=${encodeURIComponent(comecarUrl)}`)
      .then(res => res.json())
      .then(data => {
        if (data.qr) setPageQrUrl(data.qr);
      })
      .catch(() => {});

    refreshGatewayStatus();
    const interval = setInterval(refreshGatewayStatus, 3000);
    return () => clearInterval(interval);
  }, [showSimpleFallback]);

  // Set up light-dismiss fallback on <dialog> for browsers without native closedby support
  useEffect(() => {
    const dialog = videoDialogRef.current;
    if (!dialog) return;

    const handleBackdropClick = (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );
      if (isDialogContent) return;
      dialog.close();
      setActiveVideoModal(null);
    };

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', handleBackdropClick);
      return () => dialog.removeEventListener('click', handleBackdropClick);
    }
  }, []);

  const openVideoHelper = (videoType) => {
    setActiveVideoModal(videoType);
    if (videoDialogRef.current) {
      videoDialogRef.current.showModal();
    }
  };

  const closeVideoHelper = () => {
    if (videoDialogRef.current) {
      videoDialogRef.current.close();
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setActiveVideoModal(null);
  };

  // Main 1-Click Connect Handler — ALWAYS turns the bot ON immediately!
  const handleConnectWhatsApp = async () => {
    setConnecting(true);
    await activateBotAutomatically();

    // If phone is already paired via QR Code, mark connected & bot ON immediately in 1 click!
    if (waGatewayStatus && waGatewayStatus.status === 'CONNECTED') {
      setTimeout(() => {
        setConnecting(false);
        setConnected(true);
      }, 300);
      return;
    }

    // Only call window.FB.login if explicitly enabled with window.ENABLE_FB_JSSDK
    if (window.ENABLE_FB_JSSDK && window.FB && typeof window.FB.login === 'function') {
      try {
        window.FB.login(
          (response) => {
            if (response && response.authResponse && response.authResponse.accessToken) {
              fetch('/api/client/embedded_signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  token,
                  access_token: response.authResponse.accessToken
                })
              })
                .then(res => res.json())
                .then(async (data) => {
                  await activateBotAutomatically();
                  setConnecting(false);
                  if (data.status === 'ok') {
                    setConnected(true);
                  } else {
                    setShowSimpleFallback(true);
                  }
                })
                .catch(() => {
                  setConnecting(false);
                  setShowSimpleFallback(true);
                });
            } else {
              setConnecting(false);
              setShowSimpleFallback(true);
            }
          },
          { scope: 'whatsapp_business_management' }
        );
        return;
      } catch (e) {
        // Fallback immediately
      }
    }

    // Open the instant connection panel (Direct QR Code + 2-field fallback with 15s videos)
    setTimeout(() => {
      setConnecting(false);
      setShowSimpleFallback(true);
    }, 250);
  };

  const handleFallbackConnect = async (e) => {
    e.preventDefault();
    if (!code1.trim() || !code2.trim()) {
      alert('Por favor, preencha os 2 campos ou escaneie o QR Code acima com seu celular.');
      return;
    }
    setConnecting(true);
    try {
      await activateBotAutomatically();
      const res = await fetch('/api/client/embedded_signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          code_1: code1.trim(),
          code_2: code2.trim()
        })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        setConnected(true);
        setShowSimpleFallback(false);
      }
    } catch (err) {
      alert('Não foi possível conectar agora. Tente novamente.');
    } finally {
      setConnecting(false);
    }
  };

  const handleInstallMobilePWA = async () => {
    setShowInstallGuide(true);
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    }
  };

  const videoSlidesField1 = [
    {
      icon: '🌐',
      headline: 'Passo 1: Abra o Painel do Facebook',
      caption: 'Entre na página do seu aplicativo no Facebook e clique em WhatsApp no menu lateral.',
      narration: 'Passo 1: Entre na página do seu aplicativo no Facebook e clique em WhatsApp no menu lateral.'
    },
    {
      icon: '🔑',
      headline: 'Passo 2: Clique em Copiar Chave',
      caption: 'No topo da tela você verá um botão azul escrito Copiar Chave. Clique nele.',
      narration: 'Passo 2: No topo da tela você verá um botão azul escrito Copiar Chave. Clique nele.'
    },
    {
      icon: '📋',
      headline: 'Passo 3: Cole no Primeiro Campo',
      caption: 'Volte aqui para o Bot do Studio e cole no primeiro campo. Pronto!',
      narration: 'Passo 3: Volte aqui para o Bot do Studio e cole no primeiro campo. Pronto!'
    }
  ];

  const videoSlidesField2 = [
    {
      icon: '📞',
      headline: 'Passo 1: Olhe Abaixo do seu Telefone',
      caption: 'Na mesma tela do Facebook, olhe logo abaixo do seu número de telefone.',
      narration: 'Passo 1: Na mesma tela do Facebook, olhe logo abaixo do seu número de telefone.'
    },
    {
      icon: '🔢',
      headline: 'Passo 2: Copie os 15 Números',
      caption: 'Existe um número de 15 dígitos chamado Identificador do Telefone. Clique em copiar.',
      narration: 'Passo 2: Existe um número de 15 dígitos chamado Identificador do Telefone. Clique em copiar.'
    },
    {
      icon: '✅',
      headline: 'Passo 3: Cole no Segundo Campo',
      caption: 'Cole esses números no segundo campo e clique no botão verde Conectar Agora!',
      narration: 'Passo 3: Cole esses números no segundo campo e clique no botão verde Conectar Agora!'
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', alignItems: 'center', paddingBottom: '80px' }}>
      {/* HERO CARD: 1-Click Experience for Non-Technical Photographer */}
      {!connected ? (
        <div style={{
          backgroundColor: 'var(--wa-card)',
          padding: '40px 28px',
          borderRadius: '20px',
          border: '2px solid var(--wa-green)',
          textAlign: 'center',
          maxWidth: '640px',
          width: '100%',
          boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '18px'
        }}>
          <div style={{
            backgroundColor: 'rgba(37, 211, 102, 0.15)',
            color: 'var(--wa-green)',
            padding: '8px 18px',
            borderRadius: '30px',
            fontSize: '14px',
            fontWeight: 'bold'
          }}>
            ✨ Simples, Rápido e Automático
          </div>

          <h1 style={{
            fontSize: 'clamp(26px, 5vw, 36px)',
            fontWeight: '800',
            color: '#ffffff',
            lineHeight: '1.25'
          }}>
            Seu Atendimento Automático em 2 minutos 📸
          </h1>

          <p style={{
            fontSize: 'clamp(16px, 3vw, 20px)',
            color: '#d1d7db',
            fontWeight: '500'
          }}>
            Sem precisar entender nada técnico
          </p>

          {/* GIANT GREEN CENTERED BUTTON */}
          <div style={{ width: '100%', marginTop: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handleConnectWhatsApp}
              disabled={connecting}
              style={{
                backgroundColor: '#25D366',
                color: '#111b21',
                fontSize: 'clamp(18px, 4vw, 23px)',
                fontWeight: '900',
                padding: '24px 36px',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '480px',
                boxShadow: '0 8px 25px rgba(37, 211, 102, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                letterSpacing: '0.5px'
              }}
            >
              <span style={{ fontSize: '28px' }}>💬</span>
              {connecting ? 'CONECTANDO SEU WHATSAPP...' : 'CONECTAR MEU WHATSAPP'}
            </button>

            <span style={{
              fontSize: '14px',
              color: '#b0bac0',
              marginTop: '4px'
            }}>
              Funciona junto com seu WhatsApp normal, não apaga nada
            </span>
          </div>

          {/* CONNECTION OPTIONS PANEL (QR CODE + 2-FIELD FALLBACK WITH 15s VIDEOS) */}
          {showSimpleFallback && (
            <div style={{
              marginTop: '20px',
              width: '100%',
              backgroundColor: 'var(--wa-panel)',
              padding: '24px',
              borderRadius: '16px',
              border: '2px solid #25D366',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}>
              {/* Option A: Instant Scan with Cellphone Camera */}
              <div style={{
                backgroundColor: 'var(--wa-card)',
                padding: '20px',
                borderRadius: '14px',
                border: '1px solid var(--wa-green)',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{ fontSize: '17px', fontWeight: 'bold', color: '#25D366' }}>
                  📲 Opção Mais Fácil: Aponte a Câmera do seu WhatsApp
                </div>

                {waGatewayStatus?.status === 'CONNECTED' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    <div style={{ fontSize: '15px', color: '#fff' }}>
                      ✅ Seu WhatsApp <strong>+{waGatewayStatus.connectedNumber}</strong> já está conectado!
                    </div>
                    <button
                      type="button"
                      onClick={() => setConnected(true)}
                      style={{
                        backgroundColor: '#25D366',
                        color: '#111b21',
                        padding: '14px 24px',
                        borderRadius: '10px',
                        fontSize: '16px',
                        fontWeight: 'bold'
                      }}
                    >
                      Continuar ➔
                    </button>
                  </div>
                ) : waGatewayStatus?.qr ? (
                  <>
                    <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '12px' }}>
                      <img src={waGatewayStatus.qr} alt="QR WhatsApp" style={{ width: '210px', height: '210px', display: 'block' }} />
                    </div>
                    <p style={{ fontSize: '13.5px', color: '#d1d7db', lineHeight: '1.5' }}>
                      No seu celular, abra o WhatsApp ➔ <strong>Aparelhos Conectados</strong> ➔ <strong>Conectar um Aparelho</strong> e aponte para a imagem acima!
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: '13.5px', color: '#8696a0' }}>Carregando imagem de conexão...</p>
                )}
              </div>

              {/* Option B: 2 Simple Fields with 15s Videos beside each field */}
              <div style={{ borderTop: '1px solid var(--wa-border)', paddingTop: '16px' }}>
                <h3 style={{ fontSize: '16px', color: '#fff', fontWeight: 'bold', marginBottom: '12px' }}>
                  Ou preencha os 2 campos abaixo com ajuda em vídeo (15 segundos):
                </h3>

                <form onSubmit={handleFallbackConnect} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Field 1 */}
                  <div style={{
                    backgroundColor: 'var(--wa-card)',
                    padding: '16px',
                    borderRadius: '12px',
                    border: '1px solid var(--wa-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <label style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>
                        1. Chave de Acesso do Facebook
                      </label>
                      <button
                        type="button"
                        onClick={() => openVideoHelper('field1')}
                        style={{
                          backgroundColor: '#25D366',
                          color: '#111b21',
                          padding: '8px 14px',
                          borderRadius: '8px',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        🎬 Onde acho isso? [Ver vídeo]
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Cole aqui a primeira informação..."
                      value={code1}
                      onChange={e => setCode1(e.target.value)}
                      style={{ width: '100%', fontSize: '16px', padding: '14px' }}
                    />
                  </div>

                  {/* Field 2 */}
                  <div style={{
                    backgroundColor: 'var(--wa-card)',
                    padding: '16px',
                    borderRadius: '12px',
                    border: '1px solid var(--wa-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <label style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>
                        2. Número Identificador do Telefone
                      </label>
                      <button
                        type="button"
                        onClick={() => openVideoHelper('field2')}
                        style={{
                          backgroundColor: '#25D366',
                          color: '#111b21',
                          padding: '8px 14px',
                          borderRadius: '8px',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        🎬 Onde acho isso? [Ver vídeo]
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Cole aqui o número identificador..."
                      value={code2}
                      onChange={e => setCode2(e.target.value)}
                      style={{ width: '100%', fontSize: '16px', padding: '14px' }}
                    />
                  </div>

                  <button
                    type="submit"
                    style={{
                      backgroundColor: '#25D366',
                      color: '#111b21',
                      padding: '18px',
                      borderRadius: '12px',
                      fontSize: '18px',
                      fontWeight: 'bold',
                      width: '100%'
                    }}
                  >
                    ✅ PRONTO, CONECTAR AGORA
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* SUCCESS SCREEN: "Deu certo! ✅" */
        <div style={{
          backgroundColor: 'var(--wa-card)',
          padding: '40px 28px',
          borderRadius: '20px',
          border: '3px solid #25D366',
          textAlign: 'center',
          maxWidth: '640px',
          width: '100%',
          boxShadow: '0 14px 40px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '22px'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            backgroundColor: 'rgba(37, 211, 102, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '44px'
          }}>
            ✅
          </div>

          <h2 style={{ fontSize: '34px', fontWeight: '900', color: '#25D366' }}>
            Deu certo! ✅
          </h2>

          <p style={{ fontSize: '17px', color: '#e9edef', maxWidth: '460px', lineHeight: '1.5' }}>
            Sua secretária virtual já está pronta para responder seus clientes com carinho e anotar todos os recados!
          </p>

          {/* 2 LARGE ACTION BUTTONS */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
            width: '100%',
            marginTop: '8px'
          }}>
            <button
              onClick={handleInstallMobilePWA}
              style={{
                backgroundColor: '#25D366',
                color: '#111b21',
                padding: '22px 20px',
                borderRadius: '14px',
                fontSize: '17px',
                fontWeight: '900',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                boxShadow: '0 6px 20px rgba(37, 211, 102, 0.35)'
              }}
            >
              📱 INSTALAR APP NO CELULAR
            </button>

            <button
              onClick={onGoToDashboard}
              style={{
                backgroundColor: 'var(--wa-panel)',
                color: '#ffffff',
                padding: '22px 20px',
                borderRadius: '14px',
                fontSize: '17px',
                fontWeight: '800',
                border: '2px solid var(--wa-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px'
              }}
            >
              💻 USAR NO COMPUTADOR
            </button>
          </div>

          {/* VISUAL ILLUSTRATED INSTRUCTIONS FOR IPHONE & ANDROID */}
          {showInstallGuide && (
            <div style={{
              width: '100%',
              marginTop: '14px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '16px',
              textAlign: 'left'
            }}>
              {/* iPhone Visual Drawing */}
              <div style={{
                backgroundColor: 'var(--wa-panel)',
                padding: '20px',
                borderRadius: '14px',
                border: '1px solid var(--wa-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🍎 No iPhone (Safari)
                </div>
                <div style={{
                  backgroundColor: '#1a262d',
                  borderRadius: '10px',
                  padding: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-around',
                  border: '1px dashed #53bdeb'
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#53bdeb" strokeWidth="2">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </svg>
                    <div style={{ fontSize: '11px', color: '#53bdeb', marginTop: '4px', fontWeight: 'bold' }}>1. Compartilhar</div>
                  </div>
                  <div style={{ fontSize: '20px', color: '#8696a0' }}>➔</div>
                  <div style={{ textAlign: 'center' }}>
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="4" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                    <div style={{ fontSize: '11px', color: '#25D366', marginTop: '4px', fontWeight: 'bold' }}>2. Tela de Início</div>
                  </div>
                </div>
                <p style={{ fontSize: '13.5px', color: '#d1d7db', lineHeight: '1.4' }}>
                  Toque em <strong>Compartilhar &gt; Adicionar à Tela de Início</strong> na barra inferior do iPhone.
                </p>
              </div>

              {/* Android Visual Drawing */}
              <div style={{
                backgroundColor: 'var(--wa-panel)',
                padding: '20px',
                borderRadius: '14px',
                border: '1px solid var(--wa-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🤖 No Android (Chrome)
                </div>
                <div style={{
                  backgroundColor: '#1a262d',
                  borderRadius: '10px',
                  padding: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-around',
                  border: '1px dashed #25D366'
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#e9edef" strokeWidth="2.5">
                      <circle cx="12" cy="5" r="1.5" fill="#e9edef" />
                      <circle cx="12" cy="12" r="1.5" fill="#e9edef" />
                      <circle cx="12" cy="19" r="1.5" fill="#e9edef" />
                    </svg>
                    <div style={{ fontSize: '11px', color: '#e9edef', marginTop: '4px', fontWeight: 'bold' }}>1. Menu (3 pontos)</div>
                  </div>
                  <div style={{ fontSize: '20px', color: '#8696a0' }}>➔</div>
                  <div style={{ textAlign: 'center' }}>
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2">
                      <rect x="5" y="2" width="14" height="20" rx="2" />
                      <path d="M12 10v6" />
                      <path d="M9 13l3 3 3-3" />
                    </svg>
                    <div style={{ fontSize: '11px', color: '#25D366', marginTop: '4px', fontWeight: 'bold' }}>2. Instalar</div>
                  </div>
                </div>
                <p style={{ fontSize: '13.5px', color: '#d1d7db', lineHeight: '1.4' }}>
                  Toque no botão <strong>Instalar</strong> que aparece na tela ou no menu superior do navegador.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* COLLAPSIBLE QR CODE OF THE /comecar PAGE FOR STORE / PC */}
      <details style={{
        backgroundColor: 'var(--wa-card)',
        padding: '18px 24px',
        borderRadius: '16px',
        border: '1px solid var(--wa-border)',
        maxWidth: '640px',
        width: '100%',
        textAlign: 'center'
      }}>
        <summary style={{
          fontSize: '15px',
          fontWeight: 'bold',
          color: '#d1d7db',
          cursor: 'pointer',
          listStyle: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        }}>
          <span>📱 Abrir em outro computador/celular ou imprimir QR Code desta página</span>
          <span style={{ color: 'var(--wa-green)', fontSize: '13px' }}>▼</span>
        </summary>

        <div style={{
          marginTop: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '14px'
        }}>
          <p style={{ fontSize: '13.5px', color: 'var(--wa-muted)', maxWidth: '460px', lineHeight: '1.4' }}>
            Aponte qualquer câmera para abrir esta página <strong>/comecar</strong>:
          </p>

          {pageQrUrl && (
            <div style={{
              backgroundColor: '#ffffff',
              padding: '12px',
              borderRadius: '12px',
              boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
            }}>
              <img
                src={pageQrUrl}
                alt="QR Code da página Começar"
                style={{ width: '170px', height: '170px', display: 'block' }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => window.print()}
              style={{
                backgroundColor: 'var(--wa-panel)',
                color: '#fff',
                padding: '9px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                border: '1px solid var(--wa-border)'
              }}
            >
              🖨️ Imprimir QR Code
            </button>
            <button
              type="button"
              onClick={onGoToHelp}
              style={{
                backgroundColor: 'var(--wa-panel)',
                color: 'var(--wa-green)',
                padding: '9px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                border: '1px solid var(--wa-green)'
              }}
            >
              🎥 Ver os 3 Vídeos de Ajuda (20s)
            </button>
          </div>
        </div>
      </details>

      {/* NATIVE MODAL DIALOG FOR 15s VIDEO HELPERS (Using modern <dialog closedby="any">) */}
      <dialog
        ref={videoDialogRef}
        {...({ closedby: 'any' })}
        aria-labelledby="videoHelperTitle"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 id="videoHelperTitle" style={{ fontSize: '17px', fontWeight: 'bold', color: '#25D366' }}>
              🎬 Tutorial em Vídeo (15 segundos)
            </h3>
            <button
              type="button"
              onClick={closeVideoHelper}
              style={{
                backgroundColor: 'var(--wa-panel)',
                color: '#fff',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '13px'
              }}
            >
              ✕ Fechar
            </button>
          </div>

          {activeVideoModal && (
            <InteractiveTutorialVideo
              key={activeVideoModal}
              title={activeVideoModal === 'field1' ? 'Onde achar a Chave de Acesso' : 'Onde achar o Identificador'}
              durationSec={15}
              slides={activeVideoModal === 'field1' ? videoSlidesField1 : videoSlidesField2}
              autoPlay={true}
            />
          )}

          <button
            type="button"
            onClick={closeVideoHelper}
            style={{
              backgroundColor: '#25D366',
              color: '#111b21',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: 'bold',
              width: '100%'
            }}
          >
            Entendi, voltar para preencher
          </button>
        </div>
      </dialog>

      {/* FLOATING WHATSAPP HELP BUTTON */}
      <a
        href="https://wa.me/5534988412981?text=Oi!%20Preciso%20de%20ajuda%20para%20conectar%20o%20Bot%20do%20Studio"
        target="_blank"
        rel="noreferrer"
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          backgroundColor: '#25D366',
          color: '#111b21',
          padding: '14px 22px',
          borderRadius: '50px',
          fontWeight: '900',
          fontSize: '15px',
          textDecoration: 'none',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          zIndex: 999,
          border: '2px solid #ffffff'
        }}
      >
        <span style={{ fontSize: '22px' }}>💬</span>
        <span>Precisa de ajuda? Fala comigo</span>
      </a>
    </div>
  );
}

// ==========================================
// HELP PAGE (/ajuda) WITH 3 INTERACTIVE 20s VIDEOS
// ==========================================
function HelpVideosView({ onBack }) {
  const videos = [
    {
      id: 1,
      title: '1) Como conectar WhatsApp (20s)',
      durationSec: 20,
      slides: [
        {
          icon: '🟢',
          headline: '1. Clique no Botão Verde Gigante',
          caption: 'Na página Começar, aperte o botão verde "CONECTAR MEU WHATSAPP".',
          narration: 'Passo 1: Na página Começar, aperte o botão verde Conectar Meu WhatsApp.'
        },
        {
          icon: '📲',
          headline: '2. Aponte a Câmera do Celular',
          caption: 'No seu WhatsApp, vá em Aparelhos Conectados e aponte para o código na tela.',
          narration: 'Passo 2: No seu WhatsApp, vá em Aparelhos Conectados e aponte a câmera para o código na tela.'
        },
        {
          icon: '✅',
          headline: '3. Pronto! Atendimento Ligado',
          caption: 'Sua secretária virtual já começa a responder seus clientes na mesma hora!',
          narration: 'Passo 3: Pronto! Sua secretária virtual já começa a responder seus clientes na mesma hora!'
        }
      ]
    },
    {
      id: 2,
      title: '2) Como instalar no iPhone (20s)',
      durationSec: 20,
      slides: [
        {
          icon: '🧭',
          headline: '1. Abra no Safari do iPhone',
          caption: 'Abra o link do Bot do Studio pelo navegador Safari do seu iPhone.',
          narration: 'Passo 1: Abra o link do Bot do Studio pelo navegador Safari do seu iPhone.'
        },
        {
          icon: '⬆️',
          headline: '2. Toque em Compartilhar',
          caption: 'Toque no ícone de Compartilhar (o quadradinho com uma seta para cima na barra inferior).',
          narration: 'Passo 2: Toque no ícone de Compartilhar, o quadradinho com uma seta para cima na parte de baixo.'
        },
        {
          icon: '➕',
          headline: '3. Adicionar à Tela de Início',
          caption: 'Escolha "Adicionar à Tela de Início". O aplicativo aparecerá junto aos seus apps!',
          narration: 'Passo 3: Escolha Adicionar à Tela de Início. O aplicativo aparecerá junto aos seus outros aplicativos!'
        }
      ]
    },
    {
      id: 3,
      title: '3) Como instalar no Android (20s)',
      durationSec: 20,
      slides: [
        {
          icon: '🤖',
          headline: '1. Abra no Chrome do Android',
          caption: 'Acesse a página pelo navegador Chrome no seu celular Android.',
          narration: 'Passo 1: Acesse a página pelo navegador Chrome no seu celular Android.'
        },
        {
          icon: '⋮',
          headline: '2. Toque nos 3 Pontinhos ou Instalar',
          caption: 'Toque no botão "Instalar App no Celular" ou nos 3 pontinhos no canto superior.',
          narration: 'Passo 2: Toque no botão Instalar App no Celular ou nos três pontinhos no canto superior.'
        },
        {
          icon: '📲',
          headline: '3. Confirme em Instalar Aplicativo',
          caption: 'Toque em "Instalar" e pronto! O ícone verde do Bot do Studio ficará salvo no celular.',
          narration: 'Passo 3: Toque em Instalar e pronto! O ícone verde do Bot do Studio ficará salvo no seu celular.'
        }
      ]
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '60px' }}>
      <div style={{
        backgroundColor: 'var(--wa-card)',
        padding: '24px',
        borderRadius: '16px',
        border: '1px solid var(--wa-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 'bold', color: '#fff' }}>
            🎥 Central de Ajuda em Vídeo (20 segundos cada)
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--wa-muted)', marginTop: '4px' }}>
            Clique no botão <strong>▶ Play</strong> em qualquer vídeo abaixo para assistir com animação e áudio em português:
          </p>
        </div>

        <button
          onClick={onBack}
          style={{
            backgroundColor: '#25D366',
            color: '#111b21',
            padding: '10px 18px',
            borderRadius: '10px',
            fontSize: '14px',
            fontWeight: 'bold'
          }}
        >
          ⬅ Voltar para Começar
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '20px' }}>
        {videos.map(v => (
          <div
            key={v.id}
            style={{
              backgroundColor: 'var(--wa-card)',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid var(--wa-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
              {v.title}
            </h3>
            <InteractiveTutorialVideo
              title={v.title}
              durationSec={v.durationSec}
              slides={v.slides}
              autoPlay={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const PRESET_SLOTS = [
  { date: 'Terça', time: '09h' },
  { date: 'Terça', time: '14h' },
  { date: 'Terça', time: '15h' },
  { date: 'Terça', time: '15h30' },
  { date: 'Quarta', time: '09:30' },
  { date: 'Quinta', time: '14h' },
  { date: 'Sexta', time: '16h' },
  { date: 'Sábado', time: '10h' },
  { date: 'Sábado', time: '16:30' }
];

// ==========================================
// TAREFA 1: Configuração do Estúdio (Onboarding + Horários Reais)
// ==========================================
function OnboardingView({ token, onSaveSuccess }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  // Form fields
  const [studioName, setStudioName] = useState('Studio Fotográfico');
  const [photographerName, setPhotographerName] = useState('Gustavo');
  const [secretaryName, setSecretaryName] = useState('Ana');
  const [photographerPhone, setPhotographerPhone] = useState('');
  const [businessHours, setBusinessHours] = useState('Seg-Sex 8h-18h');

  // Selected niches & details
  const [selectedNiches, setSelectedNiches] = useState(['casal', 'familia', 'formatura', 'casamento']);
  const [nicheDetails, setNicheDetails] = useState({});

  // PARTE 1 (Item 2): Schedule slots marked by photographer
  const [slots, setSlots] = useState([]);
  const [customDate, setCustomDate] = useState('Terça');
  const [customTime, setCustomTime] = useState('15h');

  useEffect(() => {
    Promise.all([
      fetch(`/api/client/config?token=${token}`).then(res => res.json()),
      fetch('/api/client/slots').then(res => res.json())
    ])
      .then(([data, slotsData]) => {
        if (data && data.client) {
          const c = data.client;
          setStudioName(c.studio_name || 'Studio Fotográfico');
          setPhotographerName(c.photographer_name || 'Leo');
          setSecretaryName(c.secretary_name || 'Ana');
          setPhotographerPhone(c.photographer_phone || '');
          setBusinessHours(c.business_hours || 'Seg-Sex 8h-18h');

          if (c.niches_json) {
            try {
              const parsed = JSON.parse(c.niches_json);
              setSelectedNiches(Object.keys(parsed));
              setNicheDetails(parsed);
            } catch (e) {
              console.error('Error parsing niches JSON', e);
            }
          }
        }
        if (slotsData && slotsData.slots) {
          setSlots(slotsData.slots);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load client config or slots', err);
        setLoading(false);
      });
  }, [token]);

  const isPresetSelected = (date, time) => {
    return slots.some(s => s.date.toLowerCase() === date.toLowerCase() && s.time.toLowerCase() === time.toLowerCase() && s.status !== 'blocked');
  };

  const togglePresetSlot = (date, time) => {
    const existing = slots.find(s => s.date.toLowerCase() === date.toLowerCase() && s.time.toLowerCase() === time.toLowerCase());
    if (existing) {
      if (existing.status === 'busy') {
        alert('Este horário já está reservado por um cliente!');
        return;
      }
      setSlots(slots.filter(s => !(s.date.toLowerCase() === date.toLowerCase() && s.time.toLowerCase() === time.toLowerCase())));
    } else {
      setSlots([...slots, { date, time, status: 'free' }]);
    }
  };

  const handleAddCustomSlot = () => {
    const d = customDate.trim();
    const t = customTime.trim();
    if (!d || !t) return;
    if (!isPresetSelected(d, t)) {
      setSlots([...slots, { date: d, time: t, status: 'free' }]);
    }
    setCustomTime('');
  };

  const toggleNiche = (nicheId) => {
    if (selectedNiches.includes(nicheId)) {
      setSelectedNiches(selectedNiches.filter(id => id !== nicheId));
    } else {
      setSelectedNiches([...selectedNiches, nicheId]);
      if (!nicheDetails[nicheId]) {
        const template = ALL_NICHES.find(n => n.id === nicheId);
        setNicheDetails(prev => ({
          ...prev,
          [nicheId]: {
            price: template ? template.defaultPrice : 400,
            description: template ? template.defaultDesc : '',
            photos: []
          }
        }));
      }
    }
  };

  const updateNicheField = (nicheId, field, value) => {
    setNicheDetails(prev => ({
      ...prev,
      [nicheId]: {
        ...(prev[nicheId] || {}),
        [field]: value
      }
    }));
  };

  const handlePhotoUpload = async (nicheId, photoIndex, file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('niche', nicheId);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.url) {
        const currentPhotos = [...(nicheDetails[nicheId]?.photos || [])];
        currentPhotos[photoIndex] = data.url;
        updateNicheField(nicheId, 'photos', currentPhotos);
      }
    } catch (err) {
      alert('Erro no envio da foto: ' + err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);

    const payloadNiches = {};
    selectedNiches.forEach(id => {
      payloadNiches[id] = nicheDetails[id] || {
        price: ALL_NICHES.find(n => n.id === id)?.defaultPrice || 400,
        description: ALL_NICHES.find(n => n.id === id)?.defaultDesc || '',
        photos: []
      };
    });

    const payload = {
      token,
      studio_name: studioName,
      photographer_name: photographerName,
      secretary_name: secretaryName,
      photographer_phone: photographerPhone,
      business_hours: businessHours,
      niches_json: JSON.stringify(payloadNiches)
    };

    try {
      const [res, slotsRes] = await Promise.all([
        fetch('/api/client/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }),
        fetch('/api/client/slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'bulk_save',
            slots: slots.filter(s => s.status !== 'busy')
          })
        })
      ]);
      const data = await res.json();
      const sData = await slotsRes.json();
      if (sData && sData.slots) setSlots(sData.slots);

      if (data.status === 'ok') {
        setSaveMessage('Dados e horários da agenda salvos com sucesso! Sua secretária já está atualizada.');
        setTimeout(() => {
          if (onSaveSuccess) onSaveSuccess();
        }, 1200);
      } else {
        setSaveMessage('Erro ao salvar: ' + (data.error || 'Tente novamente'));
      }
    } catch (err) {
      setSaveMessage('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--wa-muted)' }}>Carregando dados do seu estúdio...</div>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ backgroundColor: 'var(--wa-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--wa-border)' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff', marginBottom: '8px' }}>
          Dados do seu Estúdio Fotográfico & Agenda
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--wa-muted)', lineHeight: '1.5' }}>
          Escolha o nome do seu estúdio, o nome da sua <strong>Secretária Virtual</strong>, os valores de cada ensaio e marque os <strong>horários livres</strong> que ela pode agendar para você.
        </p>
      </div>

      {saveMessage && (
        <div style={{
          padding: '14px 18px',
          borderRadius: '8px',
          backgroundColor: saveMessage.includes('sucesso') ? 'rgba(37, 211, 102, 0.15)' : 'rgba(234, 67, 53, 0.15)',
          color: saveMessage.includes('sucesso') ? 'var(--wa-green)' : 'var(--wa-danger)',
          border: `1px solid ${saveMessage.includes('sucesso') ? 'var(--wa-green)' : 'var(--wa-danger)'}`,
          fontSize: '14px',
          fontWeight: '500'
        }}>
          {saveMessage}
        </div>
      )}

      {/* Basic Studio Info */}
      <div style={{ backgroundColor: 'var(--wa-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--wa-border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--wa-green)' }}>
          1. Quem vai atender seus clientes
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--wa-muted)', marginBottom: '6px' }}>
              Nome do Estúdio *
            </label>
            <input
              type="text"
              required
              placeholder="Ex: Studio Leo / Studio Gustavo"
              value={studioName}
              onChange={e => setStudioName(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--wa-muted)', marginBottom: '6px' }}>
              Seu Nome (Fotógrafo) *
            </label>
            <input
              type="text"
              required
              placeholder="Ex: Gustavo ou Leo"
              value={photographerName}
              onChange={e => setPhotographerName(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--wa-green)', fontWeight: 'bold', marginBottom: '6px' }}>
              Nome da Secretária Virtual *
            </label>
            <input
              type="text"
              required
              placeholder="Ex: Ana, Julia, Carol..."
              value={secretaryName}
              onChange={e => setSecretaryName(e.target.value)}
              style={{ width: '100%', borderColor: 'var(--wa-green)' }}
            />
            <span style={{ fontSize: '11.5px', color: 'var(--wa-muted)', marginTop: '4px', display: 'block' }}>
              Ela dirá: "Oi! Aqui é a <strong>{secretaryName || 'Ana'}</strong> do <strong>{studioName}</strong>..."
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--wa-muted)', marginBottom: '6px' }}>
              Seu WhatsApp Pessoal (Para receber avisos) *
            </label>
            <input
              type="text"
              required
              placeholder="Ex: 5534999998888"
              value={photographerPhone}
              onChange={e => setPhotographerPhone(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', color: 'var(--wa-muted)', marginBottom: '6px' }}>
            Horários de Atendimento *
          </label>
          <input
            type="text"
            required
            placeholder="Ex: Seg-Sex 8h-18h"
            value={businessHours}
            onChange={e => setBusinessHours(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* PARTE 1 (Item 2): Schedule Slots Selection */}
      <div style={{ backgroundColor: 'var(--wa-card)', padding: '20px', borderRadius: '12px', border: '2px solid #25D366', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#25D366', marginBottom: '4px' }}>
            2. 📅 Horários que Você Atende (Agendamento Real no Chat)
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--wa-muted)', lineHeight: '1.4' }}>
            Marque os horários livres da sua semana. Quando o cliente pedir para agendar, a secretária mostrará as <strong>3 opções livres mais próximas</strong> e reservará automaticamente!
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {PRESET_SLOTS.map((ps, idx) => {
            const active = isPresetSelected(ps.date, ps.time);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => togglePresetSlot(ps.date, ps.time)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  backgroundColor: active ? 'rgba(37, 211, 102, 0.2)' : 'var(--wa-panel)',
                  border: `2px solid ${active ? '#25D366' : 'var(--wa-border)'}`,
                  color: active ? '#fff' : 'var(--wa-muted)',
                  fontWeight: active ? 'bold' : 'normal',
                  fontSize: '13.5px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>{active ? '✅' : '⬜'}</span>
                <span>{ps.date} {ps.time}</span>
              </button>
            );
          })}
        </div>

        {/* Custom Slot Adder */}
        <div style={{
          backgroundColor: 'var(--wa-panel)',
          padding: '14px',
          borderRadius: '10px',
          border: '1px solid var(--wa-border)',
          display: 'flex',
          gap: '10px',
          alignItems: 'flex-end',
          flexWrap: 'wrap'
        }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--wa-muted)', marginBottom: '4px' }}>
              Outro Dia (ex: Sexta)
            </label>
            <input
              type="text"
              value={customDate}
              onChange={e => setCustomDate(e.target.value)}
              placeholder="Ex: Terça"
              style={{ width: '140px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--wa-muted)', marginBottom: '4px' }}>
              Horário (ex: 15h30)
            </label>
            <input
              type="text"
              value={customTime}
              onChange={e => setCustomTime(e.target.value)}
              placeholder="Ex: 15h30"
              style={{ width: '120px' }}
            />
          </div>
          <button
            type="button"
            onClick={handleAddCustomSlot}
            style={{
              backgroundColor: '#25D366',
              color: '#111b21',
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            ➕ Adicionar Horário
          </button>
        </div>

        {/* Current Active Slots Summary */}
        <div>
          <div style={{ fontSize: '12.5px', color: 'var(--wa-muted)', marginBottom: '8px' }}>
            Horários cadastrados na sua agenda ({slots.filter(s => s.status === 'free').length} livres):
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {slots.map((s, i) => (
              <span
                key={s.id || i}
                style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '12.5px',
                  fontWeight: 'bold',
                  backgroundColor: s.status === 'busy' ? 'rgba(234, 67, 53, 0.2)' : 'rgba(37, 211, 102, 0.15)',
                  color: s.status === 'busy' ? '#ff6b6b' : '#25D366',
                  border: `1px solid ${s.status === 'busy' ? '#ff6b6b' : '#25D366'}`
                }}
              >
                {s.status === 'busy' ? `🔒 ${s.date} ${s.time} (Reservado: ${s.client_name || 'Cliente'})` : `🟢 ${s.date} ${s.time} (Livre)`}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Niches and Portfolios */}
      <div style={{ backgroundColor: 'var(--wa-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--wa-border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--wa-green)' }}>
          3. Tipos de Ensaio, Preços e 3 Fotos
        </h3>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {ALL_NICHES.map(niche => {
            const isChecked = selectedNiches.includes(niche.id);
            return (
              <label
                key={niche.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  backgroundColor: isChecked ? 'rgba(37, 211, 102, 0.15)' : 'var(--wa-panel)',
                  border: `1px solid ${isChecked ? 'var(--wa-green)' : 'var(--wa-border)'}`,
                  color: isChecked ? '#fff' : 'var(--wa-muted)',
                  cursor: 'pointer',
                  fontWeight: isChecked ? '600' : 'normal',
                  fontSize: '13.5px'
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleNiche(niche.id)}
                  style={{ accentColor: 'var(--wa-green)', cursor: 'pointer' }}
                />
                {niche.label}
              </label>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '10px' }}>
          {selectedNiches.map(nicheId => {
            const nicheMeta = ALL_NICHES.find(n => n.id === nicheId);
            const current = nicheDetails[nicheId] || {};
            const photos = current.photos || [];

            return (
              <div
                key={nicheId}
                style={{
                  backgroundColor: 'var(--wa-panel)',
                  padding: '16px',
                  borderRadius: '10px',
                  border: '1px solid var(--wa-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ fontSize: '15px', color: '#fff', fontWeight: 'bold' }}>
                    📸 Ensaio: {nicheMeta ? nicheMeta.label : nicheId}
                  </h4>
                  <span style={{ fontSize: '12px', color: 'var(--wa-green)' }}>Ativo</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--wa-muted)', marginBottom: '4px' }}>
                      Preço Base (R$) *
                    </label>
                    <input
                      type="number"
                      placeholder="Ex: 450"
                      value={current.price !== undefined ? current.price : (nicheMeta?.defaultPrice || 450)}
                      onChange={e => updateNicheField(nicheId, 'price', e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--wa-muted)', marginBottom: '4px' }}>
                      Descrição Curta *
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 1h de ensaio com 20 fotos tratadas"
                      value={current.description || nicheMeta?.defaultDesc || ''}
                      onChange={e => updateNicheField(nicheId, 'description', e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--wa-muted)', marginBottom: '8px' }}>
                    3 Fotos de Portfólio:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                    {[0, 1, 2].map(idx => {
                      const photoUrl = photos[idx];
                      return (
                        <div
                          key={idx}
                          style={{
                            height: '100px',
                            backgroundColor: 'var(--wa-card)',
                            border: '1px dashed var(--wa-border)',
                            borderRadius: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                            overflow: 'hidden'
                          }}
                        >
                          {photoUrl ? (
                            <>
                              <img
                                src={photoUrl}
                                alt={`Foto ${idx + 1}`}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                              <label
                                style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  width: '100%',
                                  backgroundColor: 'rgba(0,0,0,0.6)',
                                  color: '#fff',
                                  fontSize: '10px',
                                  textAlign: 'center',
                                  padding: '2px 0',
                                  cursor: 'pointer'
                                }}
                              >
                                Trocar
                                <input
                                  type="file"
                                  accept="image/*"
                                  style={{ display: 'none' }}
                                  onChange={e => handlePhotoUpload(nicheId, idx, e.target.files[0])}
                                />
                              </label>
                            </>
                          ) : (
                            <label
                              style={{
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '4px',
                                color: 'var(--wa-muted)',
                                fontSize: '11px',
                                padding: '10px'
                              }}
                            >
                              <span>➕ Foto {idx + 1}</span>
                              <span style={{ fontSize: '9.5px', color: 'var(--wa-muted)' }}>Enviar foto</span>
                              <input
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={e => handlePhotoUpload(nicheId, idx, e.target.files[0])}
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        style={{
          backgroundColor: 'var(--wa-green)',
          color: '#111b21',
          padding: '16px',
          borderRadius: '10px',
          fontSize: '16px',
          fontWeight: 'bold',
          cursor: saving ? 'not-allowed' : 'pointer'
        }}
      >
        {saving ? 'Salvando...' : '💾 Salvar Configurações e Horários da Agenda'}
      </button>
    </form>
  );
}

// ==========================================
// TAREFA 2: Painel de Recados, Agendamentos, Follow-ups 30h & Chat Interativo (/dashboard)
// ==========================================
function DashboardView({ token, onGoToOnboarding, onGoToComecar }) {
  const [activeSubTab, setActiveSubTab] = useState('chat'); // 'chat' | 'agendamentos' | 'followups30h'
  const [leads, setLeads] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  // Interactive Bot Chat Simulator State
  const SIM_PHONE = '5534999991234';
  const SIM_NAME = 'Cliente Teste';
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatWaiting, setChatWaiting] = useState(null);
  const [use10sTakeover, setUse10sTakeover] = useState(true);
  const [phoneTestStatus, setPhoneTestStatus] = useState(null);

  // PARTE 1: Agendamentos & Slots State
  const [appointments, setAppointments] = useState([]);
  const [slots, setSlots] = useState([]);
  const [newSlotDate, setNewSlotDate] = useState('Terça');
  const [newSlotTime, setNewSlotTime] = useState('15h');

  // PARTE 2: Follow-ups 30h State
  const [followups30h, setFollowups30h] = useState([]);
  const [simulating30h, setSimulating30h] = useState(false);
  const [botPaused, setBotPaused] = useState(false);
  const [waStatus, setWaStatus] = useState(null);

  const loadAllDashboardData = () => {
    fetch('/api/bot/status')
      .then(res => res.json())
      .then(data => {
        if (typeof data.paused === 'boolean') setBotPaused(data.paused);
      })
      .catch(() => {});

    fetch('/api/qr_status')
      .then(res => res.json())
      .then(data => {
        setWaStatus(data);
      })
      .catch(() => {});

    fetch(`/api/client/leads?token=${token}`)
      .then(res => res.json())
      .then(data => {
        setLeads(data.leads || []);
        if (data.client) setConfig(data.client);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch(`/api/messages?phone=${SIM_PHONE}`)
      .then(res => res.json())
      .then(data => {
        setChatMessages(data.messages || []);
        setChatWaiting(data.waiting || null);
      })
      .catch(() => {});

    fetch('/api/client/appointments')
      .then(res => res.json())
      .then(data => {
        setAppointments(data.appointments || []);
      })
      .catch(() => {});

    fetch('/api/client/slots')
      .then(res => res.json())
      .then(data => {
        setSlots(data.slots || []);
      })
      .catch(() => {});

    fetch('/api/client/followups_30h')
      .then(res => res.json())
      .then(data => {
        setFollowups30h(data.followups || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadAllDashboardData();
    const interval = setInterval(loadAllDashboardData, 1000);
    return () => clearInterval(interval);
  }, [token]);

  const setBotActiveState = async (shouldBeActive) => {
    try {
      const res = await fetch('/api/bot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !shouldBeActive })
      });
      const data = await res.json();
      if (typeof data.paused === 'boolean') {
        setBotPaused(data.paused);
      }
      loadAllDashboardData();
    } catch (e) {
      console.error('Error setting bot state', e);
    }
  };

  const handleToggleBot = () => {
    setBotActiveState(botPaused);
  };

  // Clicking "Conectar Celular" ALWAYS turns the bot ON automatically!
  const handleConnectPhoneAndStartBot = async () => {
    await setBotActiveState(true);
    if (waStatus?.status === 'CONNECTED') {
      setPhoneTestStatus(`✅ Celular +${waStatus.connectedNumber} conectado e Bot ligado automaticamente!`);
    } else {
      onGoToComecar();
    }
  };

  const sendSimText = async (textToSend, force10s) => {
    const clean = (textToSend !== undefined ? textToSend : chatInput).trim();
    if (!clean || chatSending) return;
    if (textToSend === undefined) setChatInput('');
    setChatSending(true);
    try {
      await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: SIM_PHONE,
          name: SIM_NAME,
          type: 'text',
          text: { body: clean },
          use_10s_timer: force10s !== undefined ? force10s : use10sTakeover
        })
      });
      loadAllDashboardData();
    } catch (e) {
      console.error('Error sending simulated message', e);
    } finally {
      setChatSending(false);
    }
  };

  const sendSimButton = async (btnTitle) => {
    if (chatSending) return;
    setChatSending(true);
    let btnId = btnTitle;
    const lower = btnTitle.toLowerCase();
    if (lower.includes('ver ensaios')) btnId = 'ver_ensaios';
    else if (lower.includes('falar')) btnId = 'falar_leo';
    else if (lower.includes('horário') || lower.includes('horario') || lower.includes('datas') || lower.includes('reservar')) btnId = 'ja_tenho_horario';
    else if (lower.includes('casal')) btnId = 'ensaio_casal';
    else if (lower.includes('familia') || lower.includes('família')) btnId = 'ensaio_familia';
    else if (lower.includes('formatura')) btnId = 'ensaio_formatura';
    else if (lower.includes('casamento')) btnId = 'ensaio_casamento';
    else if (lower.includes('gestante')) btnId = 'ensaio_gestante';
    else if (lower.includes('corporativo')) btnId = 'ensaio_corporativo';

    try {
      await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: SIM_PHONE,
          name: SIM_NAME,
          type: 'interactive',
          interactive: {
            type: 'button_reply',
            button_reply: { id: btnId, title: btnTitle }
          }
        })
      });
      loadAllDashboardData();
    } catch (e) {
      console.error('Error clicking simulated button', e);
    } finally {
      setChatSending(false);
    }
  };

  const sendSimAudio = async () => {
    if (chatSending) return;
    setChatSending(true);
    try {
      await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: SIM_PHONE,
          name: SIM_NAME,
          type: 'audio',
          audio: { id: 'mock_audio_test' }
        })
      });
      loadAllDashboardData();
    } catch (e) {
      console.error('Error simulating audio', e);
    } finally {
      setChatSending(false);
    }
  };

  const clearSimChat = async () => {
    try {
      await fetch('/api/messages/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: SIM_PHONE })
      });
      loadAllDashboardData();
    } catch (e) {
      console.error('Error clearing chat', e);
    }
  };

  const fastForwardTimer = async (secs) => {
    try {
      await fetch('/api/timers/fast_forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: SIM_PHONE, seconds: secs })
      });
      loadAllDashboardData();
    } catch (e) {
      console.error('Error fast-forwarding timer', e);
    }
  };

  const handlePhotographerRespond = async () => {
    try {
      await fetch(`/api/human_respond?phone=${SIM_PHONE}`, { method: 'POST' });
      loadAllDashboardData();
    } catch (e) {
      console.error('Error responding as human', e);
    }
  };

  const triggerRealPhoneTest = async () => {
    setPhoneTestStatus('Ligando bot e enviando mensagem para o seu WhatsApp...');
    try {
      const res = await fetch('/api/test_my_whatsapp', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'ok') {
        setBotPaused(false);
        setPhoneTestStatus(`✅ Enviado! Olhe o seu WhatsApp (+${data.phone}) e responda "1", "2" ou "Oi"!`);
      } else {
        setPhoneTestStatus(`⚠️ ${data.error || 'Conecte seu WhatsApp primeiro.'}`);
      }
    } catch (e) {
      setPhoneTestStatus('⚠️ Erro ao enviar teste para o celular.');
    }
  };

  const handleResolveLead = async (phone) => {
    try {
      const res = await fetch('/api/client/leads/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, phone })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        loadAllDashboardData();
      }
    } catch (e) {
      alert('Erro ao marcar como respondido: ' + e.message);
    }
  };

  const handleSlotAction = async (action, payload) => {
    try {
      await fetch('/api/client/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload })
      });
      loadAllDashboardData();
    } catch (e) {
      console.error('Error updating slot', e);
    }
  };

  const handleSimulate30h = async (scenario) => {
    setSimulating30h(true);
    try {
      await fetch('/api/client/followups_30h/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario })
      });
      loadAllDashboardData();
    } catch (e) {
      console.error('Error simulating 30h follow-up', e);
    } finally {
      setSimulating30h(false);
    }
  };

  const elapsedSec = chatWaiting ? Math.max(0, Math.round(chatWaiting.elapsed || 0)) : 0;
  const is10sWait = chatWaiting?.status === 'WAITING_INITIAL_10S';
  const is60sWait = chatWaiting?.status === 'WAITING_HUMAN';
  const isPhoneConnected = waStatus?.status === 'CONNECTED';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* ========================================================= */}
      {/* BARRA UNIFICADA DE CONTROLE (SEM REDUNDÂNCIAS)            */}
      {/* ========================================================= */}
      <div style={{
        backgroundColor: 'var(--wa-card)',
        padding: '18px 20px',
        borderRadius: '14px',
        border: `2px solid ${botPaused ? '#ea4335' : '#25D366'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '14px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          {/* Left: Studio & Connection Info */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '18px', color: '#fff', fontWeight: 'bold' }}>
                {config?.studio_name || 'Studio Fotográfico'}
              </h2>
              <span style={{
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 'bold',
                backgroundColor: isPhoneConnected ? 'rgba(37, 211, 102, 0.15)' : 'rgba(251, 188, 4, 0.15)',
                color: isPhoneConnected ? '#25D366' : '#fbbc04',
                border: `1px solid ${isPhoneConnected ? '#25D366' : '#fbbc04'}`
              }}>
                {isPhoneConnected ? `📱 WhatsApp +${waStatus.connectedNumber} Conectado` : '📱 Celular Desconectado'}
              </span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--wa-muted)', marginTop: '4px' }}>
              Fotógrafo: <strong style={{ color: '#fff' }}>{config?.photographer_name || 'Leo'}</strong> • Secretária: <strong style={{ color: 'var(--wa-green)' }}>{config?.secretary_name || 'Ana'}</strong>
            </div>
          </div>

          {/* Right: Accessible Bot Switch + 1-Click Connect & Activate */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <label
              htmlFor="bot-active-switch"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '10px',
                backgroundColor: botPaused ? 'rgba(234, 67, 53, 0.15)' : 'rgba(37, 211, 102, 0.15)',
                border: `1px solid ${botPaused ? '#ea4335' : '#25D366'}`,
                color: botPaused ? '#ff6b6b' : '#25D366',
                fontSize: '13.5px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              <span>{botPaused ? '🛑 Bot Pausado' : '🟢 Bot Ligado'}</span>
              <input
                id="bot-active-switch"
                type="checkbox"
                {...({ switch: '' })}
                checked={!botPaused}
                onChange={(e) => setBotActiveState(e.target.checked)}
              />
            </label>

            {(!isPhoneConnected || botPaused) && (
              <button
                type="button"
                onClick={handleConnectPhoneAndStartBot}
                style={{
                  padding: '9px 16px',
                  borderRadius: '10px',
                  backgroundColor: '#25D366',
                  color: '#111b21',
                  fontSize: '13px',
                  fontWeight: '900',
                  cursor: 'pointer'
                }}
              >
                {isPhoneConnected ? '▶️ Conectar e Ligar Bot' : '📲 Conectar Celular (Liga o Bot)'}
              </button>
            )}
          </div>
        </div>

        {/* Compact Live Timer Status Bar */}
        <div style={{
          backgroundColor: '#182229',
          padding: '10px 14px',
          borderRadius: '10px',
          border: `1px solid ${is10sWait ? '#fbbc04' : is60sWait ? '#ea4335' : '#222e35'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: is10sWait ? '#fbbc04' : is60sWait ? '#ff6b6b' : '#25D366' }}>
            {is10sWait
              ? `⏳ Aguardando fotógrafo responder: ${elapsedSec}s / 10s (Secretária assume em ${Math.max(0, 10 - elapsedSec)}s)`
              : is60sWait
              ? `🔔 Cliente aguardando fotógrafo: ${elapsedSec}s / 60s (Secretária retorna em ${Math.max(0, 60 - elapsedSec)}s)`
              : '⏱️ Regra ativa: Espera 10s na 1ª mensagem • 1 min quando pedem o fotógrafo • Follow-up em 30h'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {(is10sWait || is60sWait) ? (
              <>
                <button
                  type="button"
                  onClick={() => fastForwardTimer(is10sWait ? 11 : 62)}
                  style={{
                    backgroundColor: '#25D366',
                    color: '#111b21',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                >
                  ⏩ Pular Espera ({is10sWait ? '+10s' : '+60s'})
                </button>
                <button
                  type="button"
                  onClick={handlePhotographerRespond}
                  style={{
                    backgroundColor: '#53bdeb',
                    color: '#111b21',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                >
                  👨‍💼 Assumir Agora
                </button>
              </>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--wa-muted)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={use10sTakeover}
                  onChange={e => setUse10sTakeover(e.target.checked)}
                  style={{ accentColor: '#25D366' }}
                />
                Aguardar 10s no simulador
              </label>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* DASHBOARD NAVIGATION TABS                                 */}
      {/* ========================================================= */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveSubTab('chat')}
          style={{
            flex: 1,
            minWidth: '180px',
            padding: '12px 16px',
            borderRadius: '10px',
            fontWeight: 'bold',
            fontSize: '14px',
            backgroundColor: activeSubTab === 'chat' ? '#25D366' : 'var(--wa-card)',
            color: activeSubTab === 'chat' ? '#111b21' : '#fff',
            border: `2px solid ${activeSubTab === 'chat' ? '#25D366' : 'var(--wa-border)'}`,
            cursor: 'pointer'
          }}
        >
          💬 Chat & Recados ({leads.length})
        </button>

        <button
          onClick={() => setActiveSubTab('agendamentos')}
          style={{
            flex: 1,
            minWidth: '180px',
            padding: '12px 16px',
            borderRadius: '10px',
            fontWeight: 'bold',
            fontSize: '14px',
            backgroundColor: activeSubTab === 'agendamentos' ? '#25D366' : 'var(--wa-card)',
            color: activeSubTab === 'agendamentos' ? '#111b21' : '#fff',
            border: `2px solid ${activeSubTab === 'agendamentos' ? '#25D366' : 'var(--wa-border)'}`,
            cursor: 'pointer'
          }}
        >
          📅 Agendamentos ({appointments.length})
        </button>

        <button
          onClick={() => setActiveSubTab('followups30h')}
          style={{
            flex: 1,
            minWidth: '180px',
            padding: '12px 16px',
            borderRadius: '10px',
            fontWeight: 'bold',
            fontSize: '14px',
            backgroundColor: activeSubTab === 'followups30h' ? '#25D366' : 'var(--wa-card)',
            color: activeSubTab === 'followups30h' ? '#111b21' : '#fff',
            border: `2px solid ${activeSubTab === 'followups30h' ? '#25D366' : 'var(--wa-border)'}`,
            cursor: 'pointer'
          }}
        >
          🕒 Follow-ups de 30h ({followups30h.filter(f => f.status === 'FOLLOWUP_30H_SENT').length})
        </button>
      </div>

      {/* ========================================================= */}
      {/* ABA 2: AGENDAMENTOS REAIS & SLOTS                         */}
      {/* ========================================================= */}
      {activeSubTab === 'agendamentos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Confirmed Bookings List */}
          <div style={{
            backgroundColor: 'var(--wa-card)',
            padding: '20px',
            borderRadius: '14px',
            border: '1px solid var(--wa-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 'bold', color: '#fff' }}>
                  📅 Novos Agendamentos Confirmados pela Secretária
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--wa-muted)' }}>
                  Horários que os clientes escolheram no chat (marcados automaticamente como ocupados no banco + comprovante Pix R$100).
                </p>
              </div>
              <button
                onClick={async () => {
                  await sendSimButton('📅 Já tenho horário');
                  setActiveSubTab('chat');
                }}
                style={{
                  backgroundColor: '#25D366',
                  color: '#111b21',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                ➕ Simular Agendamento no Chat
              </button>
            </div>

            {appointments.length === 0 ? (
              <div style={{
                padding: '32px',
                textAlign: 'center',
                backgroundColor: 'var(--wa-panel)',
                borderRadius: '10px',
                color: 'var(--wa-muted)'
              }}>
                Nenhum ensaio agendado ainda. Teste clicando em <strong>"📅 Já tenho horário"</strong> no chat!
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
                {appointments.map((appt, i) => (
                  <div
                    key={appt.id || i}
                    style={{
                      backgroundColor: 'var(--wa-panel)',
                      padding: '16px',
                      borderRadius: '12px',
                      border: '1px solid #25D366',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>
                        👤 {appt.client_name || 'Cliente'}
                      </span>
                      <span style={{
                        backgroundColor: 'rgba(37, 211, 102, 0.2)',
                        color: '#25D366',
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}>
                        ✅ Reservado ({appt.slot_date} {appt.slot_time})
                      </span>
                    </div>

                    <div style={{ fontSize: '13.5px', color: 'var(--wa-muted)' }}>
                      Sessão: <strong style={{ color: '#fff' }}>{appt.session_type}</strong> • Tel: +{appt.client_phone}
                    </div>

                    {appt.receipt_text && (
                      <pre style={{
                        backgroundColor: '#111b21',
                        padding: '12px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#d1d7db',
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'monospace',
                        border: '1px solid var(--wa-border)'
                      }}>
                        {appt.receipt_text}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Slots Table Manager */}
          <div style={{
            backgroundColor: 'var(--wa-card)',
            padding: '20px',
            borderRadius: '14px',
            border: '1px solid var(--wa-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
              🗓️ Horários da Semana (Liberar ou Bloquear)
            </h3>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                value={newSlotDate}
                onChange={e => setNewSlotDate(e.target.value)}
                placeholder="Dia (ex: Terça)"
                style={{ width: '140px' }}
              />
              <input
                type="text"
                value={newSlotTime}
                onChange={e => setNewSlotTime(e.target.value)}
                placeholder="Hora (ex: 15h)"
                style={{ width: '120px' }}
              />
              <button
                onClick={() => handleSlotAction('add', { date: newSlotDate, time: newSlotTime })}
                style={{
                  backgroundColor: '#25D366',
                  color: '#111b21',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                ➕ Adicionar Horário Livre
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
              {slots.map(s => (
                <div
                  key={s.id}
                  style={{
                    backgroundColor: 'var(--wa-panel)',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: `1px solid ${s.status === 'free' ? '#25D366' : s.status === 'busy' ? '#ff6b6b' : '#8696a0'}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14.5px', fontWeight: 'bold', color: '#fff' }}>
                      {s.date} às {s.time}
                    </div>
                    <div style={{ fontSize: '12px', color: s.status === 'free' ? '#25D366' : s.status === 'busy' ? '#ff6b6b' : '#8696a0' }}>
                      {s.status === 'free'
                        ? '🟢 Livre (free)'
                        : s.status === 'busy'
                        ? `🔴 Ocupado: ${s.client_name || 'Cliente'} (${s.ensaio_type || 'Ensaio'})`
                        : '⚪ Bloqueado (blocked)'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    {s.status !== 'free' ? (
                      <button
                        onClick={() => handleSlotAction('toggle', { id: s.id, status: 'free' })}
                        style={{
                          backgroundColor: '#2a3942',
                          color: '#25D366',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          fontSize: '11.5px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        Liberar
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSlotAction('toggle', { id: s.id, status: 'blocked' })}
                        style={{
                          backgroundColor: '#2a3942',
                          color: '#8696a0',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          fontSize: '11.5px',
                          cursor: 'pointer'
                        }}
                      >
                        Bloquear
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ABA 3: FOLLOW-UPS INTELIGENTES DE 30H + JANELA 24H        */}
      {/* ========================================================= */}
      {activeSubTab === 'followups30h' && (
        <div style={{
          backgroundColor: 'var(--wa-card)',
          padding: '20px',
          borderRadius: '14px',
          border: '1px solid var(--wa-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div>
            <h3 style={{ fontSize: '17px', fontWeight: 'bold', color: '#fff', marginBottom: '4px' }}>
              🕒 Follow-up Inteligente de 30h com Análise de Contexto & Janela de 24h
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--wa-muted)', lineHeight: '1.5' }}>
              Verifica automaticamente a cada 1 hora clientes em <code>WAITING_HUMAN</code> há mais de 30 horas sem resposta humana e sem horário marcado. Analisa todo o histórico e respeita a janela de 24h do WhatsApp.
            </p>
          </div>

          {/* 1-Click Test Scenarios for 30h Follow-up */}
          <div style={{
            backgroundColor: '#182229',
            padding: '14px',
            borderRadius: '10px',
            border: '1px solid var(--wa-border)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center'
          }}>
            <span style={{ fontSize: '12.5px', color: '#fff', fontWeight: 'bold' }}>
              ⚡ Testar Motor de 30h Agora:
            </span>
            <button
              disabled={simulating30h}
              onClick={() => handleSimulate30h('urgent_over24h')}
              style={{
                backgroundColor: '#25D366',
                color: '#111b21',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              🚨 Caso Urgente (&gt;24h Template + Prioridade)
            </button>
            <button
              disabled={simulating30h}
              onClick={() => handleSimulate30h('schedule_under24h')}
              style={{
                backgroundColor: '#2a3942',
                color: '#25D366',
                border: '1px solid #25D366',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              🎁 Queria Agendar (&lt;24h Horário Extra c/ Bônus)
            </button>
            <button
              disabled={simulating30h}
              onClick={() => handleSimulate30h('recovery_over24h')}
              style={{
                backgroundColor: '#2a3942',
                color: '#53bdeb',
                border: '1px solid #53bdeb',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              💬 Recuperação Natural (&gt;24h Template)
            </button>
            <button
              disabled={simulating30h}
              onClick={() => handleSimulate30h('auto_closed')}
              style={{
                backgroundColor: '#2a3942',
                color: '#8696a0',
                border: '1px solid #8696a0',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              🔒 Cliente Já Resolveu (auto_closed)
            </button>
          </div>

          {followups30h.length === 0 ? (
            <div style={{
              padding: '32px',
              textAlign: 'center',
              backgroundColor: 'var(--wa-panel)',
              borderRadius: '10px',
              color: 'var(--wa-muted)'
            }}>
              Nenhum follow-up de 30h disparado ainda. Clique em um dos botões acima para testar!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {followups30h.map((item, idx) => (
                <div
                  key={item.id || idx}
                  style={{
                    backgroundColor: 'var(--wa-panel)',
                    padding: '16px',
                    borderRadius: '12px',
                    border: `1px solid ${item.status === 'FOLLOWUP_30H_SENT' ? '#25D366' : item.status === 'auto_closed' ? '#8696a0' : '#fbbc04'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>
                      👤 {item.client_name || 'Cliente'} (+{item.client_phone}) • <span style={{ color: '#25D366' }}>{item.session_type || 'Ensaio'}</span>
                    </div>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      backgroundColor: item.status === 'FOLLOWUP_30H_SENT' ? 'rgba(37, 211, 102, 0.2)' : 'rgba(134, 150, 160, 0.2)',
                      color: item.status === 'FOLLOWUP_30H_SENT' ? '#25D366' : '#e9edef'
                    }}>
                      Status: {item.status} ({item.followup_action || 'aguardando'})
                    </span>
                  </div>

                  {item.window_status && (
                    <div style={{ fontSize: '12.5px', color: '#53bdeb', fontWeight: 'bold' }}>
                      🪟 Regra de Janela WhatsApp: {item.window_status}
                    </div>
                  )}

                  {item.followup_context && (
                    <div style={{ fontSize: '13px', color: 'var(--wa-muted)' }}>
                      🧠 <strong>Contexto Analisado:</strong> {item.followup_context}
                    </div>
                  )}

                  {item.followup_message && (
                    <div style={{
                      backgroundColor: '#111b21',
                      padding: '12px',
                      borderRadius: '8px',
                      fontSize: '13.5px',
                      color: '#fff',
                      whiteSpace: 'pre-wrap',
                      borderLeft: '3px solid #25D366'
                    }}>
                      {item.followup_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* ABA 1: INTERACTIVE BOT CHAT SIMULATOR & PENDING LEADS     */}
      {/* ========================================================= */}
      {activeSubTab === 'chat' && (
        <>
          <div style={{
            backgroundColor: 'var(--wa-card)',
            borderRadius: '16px',
            border: '2px solid #25D366',
            overflow: 'hidden',
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)'
          }}>
            {/* Chat Header */}
            <div style={{
              backgroundColor: '#202c33',
              padding: '14px 18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              borderBottom: '1px solid var(--wa-border)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  backgroundColor: '#25D366',
                  color: '#111b21',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  fontWeight: 'bold'
                }}>
                  🤖
                </div>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                    💬 Conversar com a Secretária {config?.secretary_name || 'Ana'} (Teste no Computador)
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#25D366' }}>
                    ● Online agora — Teste agendamento real de horários, espera de 10s e re-engajamento de 1 minuto!
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={triggerRealPhoneTest}
                  style={{
                    backgroundColor: '#25D366',
                    color: '#111b21',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '12.5px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  📱 Mandar Teste pro Meu WhatsApp
                </button>
                <button
                  onClick={clearSimChat}
                  style={{
                    backgroundColor: '#2a3942',
                    color: '#e9edef',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    border: '1px solid var(--wa-border)',
                    cursor: 'pointer'
                  }}
                >
                  🔄 Reiniciar Conversa
                </button>
              </div>
            </div>

            {phoneTestStatus && (
              <div style={{
                backgroundColor: 'rgba(37, 211, 102, 0.15)',
                borderBottom: '1px solid rgba(37, 211, 102, 0.4)',
                padding: '10px 18px',
                fontSize: '13.5px',
                color: '#25D366',
                fontWeight: 'bold',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>{phoneTestStatus}</span>
                <button
                  onClick={() => setPhoneTestStatus(null)}
                  style={{ background: 'transparent', color: '#fff', fontSize: '12px' }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Single Unified Bar of Quick Test Action Chips */}
            <div style={{
              backgroundColor: '#182229',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              borderBottom: '1px solid var(--wa-border)'
            }}>
              <span style={{ fontSize: '12px', color: 'var(--wa-muted)', fontWeight: 'bold' }}>
                Atalhos de teste:
              </span>
              <button
                onClick={() => sendSimText('Oi! Tudo bem?', false)}
                style={{
                  backgroundColor: '#202c33',
                  color: '#fff',
                  border: '1px solid #374751',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '12.5px',
                  cursor: 'pointer'
                }}
              >
                👋 Mandar "Oi"
              </button>
              <button
                onClick={() => sendSimText('Oi, o Gustavo está?', true)}
                style={{
                  backgroundColor: '#202c33',
                  color: '#fbbc04',
                  border: '1px solid #fbbc04',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '12.5px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                ⏱️ Espera de 10s
              </button>
              <button
                onClick={() => sendSimButton('📅 Já tenho horário')}
                style={{
                  backgroundColor: '#202c33',
                  color: '#25D366',
                  border: '1px solid #25D366',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '12.5px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                📅 Agendar Horário
              </button>
              <button
                onClick={() => sendSimText('Quero falar com o Gustavo', false)}
                style={{
                  backgroundColor: '#202c33',
                  color: '#fff',
                  border: '1px solid #374751',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '12.5px',
                  cursor: 'pointer'
                }}
              >
                💬 Chamar Fotógrafo (1 min)
              </button>
              <button
                onClick={sendSimAudio}
                style={{
                  backgroundColor: '#202c33',
                  color: '#fff',
                  border: '1px solid #374751',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '12.5px',
                  cursor: 'pointer'
                }}
              >
                🎙️ Enviar Áudio
              </button>
            </div>

            {/* Chat Messages Area */}
            <div style={{
              height: '380px',
              overflowY: 'auto',
              padding: '18px',
              backgroundColor: '#0b141a',
              backgroundImage: 'radial-gradient(#1e2b33 1px, transparent 0)',
              backgroundSize: '20px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              {chatMessages.length === 0 ? (
                <div style={{
                  margin: 'auto',
                  textAlign: 'center',
                  maxWidth: '400px',
                  backgroundColor: '#182229',
                  padding: '22px',
                  borderRadius: '14px',
                  border: '1px solid var(--wa-border)'
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '6px' }}>💬</div>
                  <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginBottom: '4px' }}>
                    Simulador pronto para conversar
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--wa-muted)', lineHeight: '1.4' }}>
                    Digite uma mensagem no campo abaixo ou clique em um dos atalhos acima para conversar com a secretária.
                  </div>
                </div>
              ) : (
                chatMessages.map((msg, i) => {
                  const isBot = msg.direction === 'bot';
                  let bodyText = msg.content || '';
                  let buttons = [];
                  let imageUrl = null;

                  if (msg.message_type === 'button' && bodyText.includes(' | Buttons: ')) {
                    const parts = bodyText.split(' | Buttons: ');
                    bodyText = parts[0];
                    try {
                      buttons = JSON.parse(parts[1].replace(/'/g, '"'));
                    } catch (e) {
                      buttons = [];
                    }
                  } else if (msg.message_type === 'image') {
                    const imgMatch = bodyText.match(/Image:\s*([^\s]+)\s*\(Caption:\s*(.*)\)/);
                    if (imgMatch) {
                      imageUrl = imgMatch[1];
                      bodyText = imgMatch[2] || '';
                    }
                  }

                  return (
                    <div
                      key={msg.id || i}
                      style={{
                        alignSelf: isBot ? 'flex-start' : 'flex-end',
                        backgroundColor: isBot ? '#202c33' : '#005c4b',
                        color: '#e9edef',
                        padding: '12px 15px',
                        borderRadius: '12px',
                        borderTopLeftRadius: isBot ? '2px' : '12px',
                        borderTopRightRadius: isBot ? '12px' : '2px',
                        maxWidth: '78%',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.25)'
                      }}
                    >
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 'bold',
                        color: isBot ? '#25D366' : '#8696a0',
                        marginBottom: '4px'
                      }}>
                        {isBot ? `🤖 Secretária ${config?.secretary_name || 'Ana'}` : '👤 Você (simulando cliente)'}
                      </div>

                      {imageUrl && (
                        <img
                          src={imageUrl}
                          alt="Foto de Portfólio"
                          style={{
                            width: '100%',
                            maxWidth: '280px',
                            maxHeight: '200px',
                            objectFit: 'cover',
                            borderRadius: '8px',
                            marginBottom: '8px',
                            display: 'block'
                          }}
                        />
                      )}

                      <div style={{ fontSize: '14.5px', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                        {bodyText}
                      </div>

                      {buttons.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                          {buttons.map((b, bIdx) => (
                            <button
                              key={bIdx}
                              onClick={() => sendSimText(b.replace('📅 ', '').trim(), false)}
                              style={{
                                backgroundColor: '#2a3942',
                                color: '#53bdeb',
                                border: '1px solid #3b4a54',
                                padding: '9px 12px',
                                borderRadius: '8px',
                                fontSize: '13.5px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                textAlign: 'center'
                              }}
                            >
                              {b}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Chat Input Footer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendSimText();
              }}
              style={{
                backgroundColor: '#202c33',
                padding: '12px 16px',
                display: 'flex',
                gap: '10px',
                alignItems: 'center',
                borderTop: '1px solid var(--wa-border)'
              }}
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Digite aqui (ex: Oi, Quero falar com o Gustavo, Terça 15h)..."
                style={{
                  flex: 1,
                  backgroundColor: '#2a3942',
                  color: '#fff',
                  border: '1px solid #3b4a54',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  fontSize: '15px'
                }}
              />
              <button
                type="submit"
                disabled={chatSending}
                style={{
                  backgroundColor: '#25D366',
                  color: '#111b21',
                  padding: '12px 22px',
                  borderRadius: '10px',
                  fontSize: '15px',
                  fontWeight: 'bold',
                  cursor: chatSending ? 'not-allowed' : 'pointer'
                }}
              >
                {chatSending ? 'Enviando...' : 'Enviar ➤'}
              </button>
            </form>
          </div>

          {/* Pending Messages List */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                📬 Mensagens Pendentes (Clientes aguardando você)
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--wa-muted)' }}>Atualiza a cada 1s</span>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--wa-muted)' }}>Carregando recados...</div>
            ) : leads.length === 0 ? (
              <div style={{
                backgroundColor: 'var(--wa-card)',
                padding: '36px',
                borderRadius: '12px',
                textAlign: 'center',
                border: '1px solid var(--wa-border)',
                color: 'var(--wa-muted)'
              }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>☕</div>
                <div style={{ fontSize: '15px', color: '#fff', fontWeight: '500', marginBottom: '4px' }}>
                  Nenhum cliente aguardando no momento
                </div>
                <div style={{ fontSize: '13px' }}>
                  Quando um cliente pedir para falar com você ou deixar um áudio/recado, ele aparecerá aqui.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {leads.map((lead, idx) => {
                  const secondsWaiting = Math.max(0, Math.round(Date.now() / 1000 - lead.waiting_since));
                  const minutesWaiting = Math.floor(secondsWaiting / 60);
                  return (
                    <div
                      key={lead.id || idx}
                      style={{
                        backgroundColor: 'var(--wa-card)',
                        padding: '18px',
                        borderRadius: '12px',
                        border: '1px solid rgba(234, 67, 53, 0.4)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>
                            👤 {lead.client_name || 'Cliente WhatsApp'}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--wa-muted)', marginTop: '2px' }}>
                            WhatsApp: <a href={`https://wa.me/${lead.client_phone}`} target="_blank" rel="noreferrer" style={{ color: 'var(--wa-blue)', textDecoration: 'none' }}>
                              +{lead.client_phone}
                            </a>
                          </div>
                        </div>

                        <div style={{
                          backgroundColor: 'rgba(234, 67, 53, 0.15)',
                          color: 'var(--wa-danger)',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600'
                        }}>
                          ⏱️ Aguardando há {minutesWaiting > 0 ? `${minutesWaiting} min (${secondsWaiting}s)` : `${secondsWaiting}s`}
                        </div>
                      </div>

                      {lead.audio_url && (
                        <div style={{
                          backgroundColor: 'var(--wa-panel)',
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid var(--wa-border)'
                        }}>
                          <div style={{ fontSize: '12px', color: 'var(--wa-green)', fontWeight: 'bold', marginBottom: '6px' }}>
                            🎙️ Áudio do Cliente:
                          </div>
                          <audio controls src={lead.audio_url} style={{ width: '100%', height: '36px' }} />
                        </div>
                      )}

                      <div style={{
                        backgroundColor: 'var(--wa-panel)',
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid var(--wa-border)'
                      }}>
                        <div style={{ fontSize: '12px', color: 'var(--wa-muted)', marginBottom: '4px', fontWeight: '600' }}>
                          {lead.audio_url ? '✨ Áudio escrito para você ler:' : '✍️ Mensagem escrita:'}
                        </div>
                        <div style={{ fontSize: '14px', color: '#fff', fontStyle: 'italic', lineHeight: '1.4' }}>
                          "{lead.transcription || lead.message_content || 'Cliente solicitou atendimento do fotógrafo'}"
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                        <a
                          href={`https://wa.me/${lead.client_phone}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            flex: 1,
                            textDecoration: 'none',
                            textAlign: 'center',
                            backgroundColor: 'var(--wa-green)',
                            color: '#111b21',
                            padding: '10px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                          }}
                        >
                          💬 Responder no WhatsApp
                        </a>

                        <button
                          onClick={() => handleResolveLead(lead.client_phone)}
                          style={{
                            backgroundColor: 'var(--wa-card-hover)',
                            color: '#fff',
                            padding: '10px 16px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            border: '1px solid var(--wa-border)'
                          }}
                        >
                          ✅ Marcar como respondido
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
