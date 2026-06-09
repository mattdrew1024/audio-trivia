import React, { useState, useRef, useEffect } from 'react';
import { Play, SkipForward, Users, Music, Trophy, CheckCircle, Smartphone, Monitor, Clock, QrCode } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';

// --- FIREBASE INITIALIZATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBU2ZVzQCqbA3fOkrsXBFfQ3W0GAmezXkY",
  authDomain: "audio-trivia-a7873.firebaseapp.com",
  projectId: "audio-trivia-a7873",
  storageBucket: "audio-trivia-a7873.firebasestorage.app",
  messagingSenderId: "580447995117",
  appId: "1:580447995117:web:f024f09a58ed77bf3af8e4",
  measurementId: "G-0T5JGMWDPV"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'audio-trivia-a7873';

const getGamesCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'games');
const getPlayersCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'players');

const GAME_STATES = {
  SETUP: 'setup',
  LOBBY: 'lobby',
  Q_ARTIST: 'question_artist',
  REV_ARTIST: 'reveal_artist',
  Q_TITLE: 'question_title',
  REV_TITLE: 'reveal_title',
  LEADERBOARD: 'leaderboard'
};

const MAX_PHASE_TIME_SEC = 15;
const MAX_POINTS = 1000;

// Pre-configured questions for the prototype. In production, a setup UI would populate these.
const PLAYLIST = [
  {
    id: 1,
    title: 'Electronic Tech Track',
    artist: 'SoundHelix',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    startTime: 15,
    artistOptions: ['Daft Punk', 'SoundHelix', 'Deadmau5', 'Skrillex'],
    titleOptions: ['Digital Love', 'Electronic Tech Track', 'Neon Nights', 'Circuit Breaker']
  },
  {
    id: 2,
    title: 'Upbeat Groove',
    artist: 'AudioBinger',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    startTime: 30,
    artistOptions: ['AudioBinger', 'The Weeknd', 'Kavinsky', 'Justice'],
    titleOptions: ['Midnight City', 'Starboy', 'Upbeat Groove', 'Synthwave Run']
  }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [gamePin, setGamePin] = useState('');
  
  const [gameState, setGameState] = useState(null);
  const [players, setPlayers] = useState([]);
  
  const [joinName, setJoinName] = useState('');
  
  // Look for a PIN in the URL parameters (e.g., from scanning a QR code)
  const [urlPin, setUrlPin] = useState('');
  const [joinPin, setJoinPin] = useState(''); // State for manual PIN entry
  
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  // 1. AUTH & URL PARSING
  useEffect(() => {
    // Check if player is joining via QR Code URL
    const params = new URLSearchParams(window.location.search);
    const pinParam = params.get('pin');
    if (pinParam) {
      setUrlPin(pinParam.toUpperCase());
      setJoinPin(pinParam.toUpperCase()); // Pre-fill manual input if URL param exists
    }

    signInAnonymously(auth).catch(console.error);
    return onAuthStateChanged(auth, setUser);
  }, []);

  // 2. FIREBASE SYNC
  useEffect(() => {
    if (!user || !gamePin) return;

    const unsubGame = onSnapshot(doc(getGamesCollection(), gamePin), (docSnap) => {
      if (docSnap.exists()) {
        setGameState(docSnap.data());
      } else if (role === 'player') {
        setRole(null); setGamePin('');
      }
    });

    const unsubPlayers = onSnapshot(getPlayersCollection(), (querySnapshot) => {
      const allPlayers = [];
      querySnapshot.forEach(doc => {
        if (doc.data().gameId === gamePin) allPlayers.push({ id: doc.id, ...doc.data() });
      });
      setPlayers(allPlayers);
    });

    return () => { unsubGame(); unsubPlayers(); };
  }, [user, gamePin, role]);

  // Timer loop for Host and Player UI
  useEffect(() => {
    let interval;
    if (gameState && (gameState.status === GAME_STATES.Q_ARTIST || gameState.status === GAME_STATES.Q_TITLE)) {
      interval = setInterval(() => {
        const elapsed = (Date.now() - gameState.phaseStartTime) / 1000;
        const remaining = Math.max(0, MAX_PHASE_TIME_SEC - elapsed);
        setTimeLeft(remaining);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [gameState]);

  // 3. HOST ACTIONS
  const handleCreateGame = async () => {
    if (!user) return;
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    await setDoc(doc(getGamesCollection(), pin), {
      status: GAME_STATES.LOBBY,
      currentSongIndex: 0,
      hostUid: user.uid,
      songs: PLAYLIST,
      phaseStartTime: null
    });
    setGamePin(pin);
    setRole('host');
  };

  const playAudioClip = (durationSec, song) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = song.startTime;
    audioRef.current.play();
    setIsPlaying(true);
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }, durationSec * 1000);
  };

  const startPhase = async (newStatus) => {
    if (!gamePin || !gameState) return;
    
    // Clear all player answers before starting new question phase
    const updates = players.map(p => 
      updateDoc(doc(getPlayersCollection(), p.id), { currentAnswer: null, answerTime: null })
    );
    await Promise.all(updates);

    const song = gameState.songs[gameState.currentSongIndex];
    await updateDoc(doc(getGamesCollection(), gamePin), {
      status: newStatus,
      phaseStartTime: Date.now()
    });

    if (newStatus === GAME_STATES.Q_ARTIST) playAudioClip(3, song);
    if (newStatus === GAME_STATES.Q_TITLE) playAudioClip(15, song);
  };

  const revealAndScore = async (revealStatus) => {
    const song = gameState.songs[gameState.currentSongIndex];
    const correctAnswer = revealStatus === GAME_STATES.REV_ARTIST ? song.artist : song.title;
    
    const updates = players.map(p => {
      let pointsEarned = 0;
      if (p.currentAnswer === correctAnswer) {
        const elapsedSec = (p.answerTime - gameState.phaseStartTime) / 1000;
        const timeRatio = Math.min(Math.max(elapsedSec / MAX_PHASE_TIME_SEC, 0), 1);
        pointsEarned = Math.round(MAX_POINTS * (1 - (timeRatio / 2)));
      }
      return updateDoc(doc(getPlayersCollection(), p.id), {
        score: p.score + pointsEarned,
        lastPointsEarned: pointsEarned
      });
    });

    await Promise.all(updates);
    await updateDoc(doc(getGamesCollection(), gamePin), { status: revealStatus });
  };

  const nextRound = async () => {
    const nextIndex = gameState.currentSongIndex + 1;
    if (nextIndex < gameState.songs.length) {
      await updateDoc(doc(getGamesCollection(), gamePin), {
        currentSongIndex: nextIndex,
        status: GAME_STATES.Q_ARTIST,
        phaseStartTime: Date.now()
      });
      playAudioClip(3, gameState.songs[nextIndex]);
    } else {
      await updateDoc(doc(getGamesCollection(), gamePin), { status: GAME_STATES.LEADERBOARD });
    }
  };

  // 4. PLAYER ACTIONS
  const handleJoinGame = async (e) => {
    e.preventDefault();
    const finalPin = urlPin || joinPin; 
    if (!user || !finalPin || !joinName) return;
    await setDoc(doc(getPlayersCollection(), user.uid), {
      gameId: finalPin,
      name: joinName,
      score: 0,
      currentAnswer: null,
      answerTime: null,
      lastPointsEarned: 0
    });
    setGamePin(finalPin);
    setRole('player');
  };

  const submitAnswer = async (answer) => {
    if (!user) return;
    await updateDoc(doc(getPlayersCollection(), user.uid), {
      currentAnswer: answer,
      answerTime: Date.now()
    });
  };

  // --- UI RENDERERS ---

  const renderLanding = () => (
    <div className="min-h-screen bg-slate-950 font-sans flex flex-col items-center justify-center p-6">
      <div className="flex items-center gap-4 mb-12">
        <div className="bg-indigo-600 p-4 rounded-2xl shadow-lg shadow-indigo-600/20"><Music className="text-white" size={48} /></div>
        <h1 className="text-6xl font-black text-white tracking-tight">AudioTrivia<span className="text-indigo-500">.io</span></h1>
      </div>
      
      <div className="w-full max-w-4xl flex justify-center">
        {urlPin ? (
          <div className="bg-slate-800 p-10 rounded-3xl border border-slate-700 shadow-2xl text-center w-full max-w-md animate-in slide-in-from-bottom-8">
            <Smartphone size={64} className="text-emerald-400 mx-auto mb-6" />
            <h2 className="text-3xl font-bold text-white mb-2">You're joining the game!</h2>
            <p className="text-slate-400 mb-8 font-mono text-lg">Room: {urlPin}</p>
            <form onSubmit={handleJoinGame} className="space-y-6">
              <input type="text" placeholder="Enter your Nickname" className="w-full bg-slate-900 border-2 border-slate-600 focus:border-indigo-500 rounded-xl p-5 text-center text-2xl text-white font-bold outline-none transition" value={joinName} onChange={e => setJoinName(e.target.value)} required autoFocus maxLength={15} />
              <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-5 rounded-xl text-2xl shadow-lg shadow-emerald-900/50 transition transform active:scale-95">Join Game Now</button>
            </form>
          </div>
        ) : (
          <div className="bg-slate-800 p-12 rounded-3xl border border-slate-700 shadow-2xl text-center w-full max-w-lg">
            <Monitor size={80} className="text-indigo-400 mx-auto mb-6" />
            <h2 className="text-4xl font-bold text-white mb-4">Host or Join</h2>
            <p className="text-slate-400 text-xl mb-10">Project this screen to host, or enter a PIN to join.</p>
            
            <form onSubmit={handleJoinGame} className="space-y-4 mb-8 pb-8 border-b border-slate-700">
              <input type="text" placeholder="Game PIN" maxLength="4" className="w-full bg-slate-900 border-2 border-slate-600 focus:border-indigo-500 rounded-xl p-4 text-center text-2xl text-white font-bold outline-none transition uppercase tracking-widest" value={joinPin} onChange={e => setJoinPin(e.target.value.toUpperCase())} required />
              <input type="text" placeholder="Nickname" className="w-full bg-slate-900 border-2 border-slate-600 focus:border-indigo-500 rounded-xl p-4 text-center text-xl text-white font-bold outline-none transition" value={joinName} onChange={e => setJoinName(e.target.value)} required maxLength={15} />
              <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-xl text-xl shadow-lg shadow-emerald-900/50 transition transform active:scale-95">Join via PIN</button>
            </form>

            <button onClick={handleCreateGame} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-6 rounded-2xl text-3xl shadow-xl shadow-indigo-900/50 transition transform active:scale-95">Start Hosting</button>
          </div>
        )}
      </div>
    </div>
  );

  const renderPlayerView = () => {
    const me = players.find(p => p.id === user.uid);
    // STRICT BOOLEAN CHECK: Forces false if 'me' is temporarily undefined during DB syncs
    const hasAnswered = !!me?.currentAnswer; 
    const song = gameState.songs[gameState.currentSongIndex];
    const colors = ['bg-red-500', 'bg-blue-500', 'bg-amber-500', 'bg-emerald-500'];

    return (
      <div className="min-h-screen bg-slate-950 flex flex-col">
        <div className="flex justify-between items-center p-6 bg-slate-900 border-b border-slate-800 shadow-md">
          <span className="text-slate-400 font-bold text-lg">{me?.name}</span>
          <span className="text-indigo-400 font-black text-2xl bg-indigo-900/40 px-4 py-2 rounded-lg">{me?.score.toLocaleString()} pts</span>
        </div>
        
        <div className="flex-1 flex flex-col p-6">
          {gameState.status === GAME_STATES.LOBBY && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <Smartphone size={80} className="text-indigo-500 mb-6 animate-pulse" />
              <h2 className="text-3xl font-black text-white mb-2">You're in!</h2>
              <p className="text-xl text-slate-400">Look at the projector. Waiting for Host to start...</p>
            </div>
          )}

          {(gameState.status === GAME_STATES.Q_ARTIST || gameState.status === GAME_STATES.Q_TITLE) && (
            <div className="flex-1 flex flex-col gap-6">
              <div className="text-center py-2">
                <div className="w-full bg-slate-800 h-4 mt-2 rounded-full overflow-hidden shadow-inner">
                  <div className="bg-indigo-500 h-full transition-all duration-100 ease-linear" style={{ width: `${(timeLeft / MAX_PHASE_TIME_SEC) * 100}%` }} />
                </div>
              </div>
              
              {hasAnswered ? (
                <div className="flex-1 flex flex-col items-center justify-center animate-in zoom-in-95">
                  <div className="w-32 h-32 bg-slate-800 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-indigo-900/20 animate-bounce">
                    <CheckCircle size={64} className="text-indigo-400"/>
                  </div>
                  <h2 className="text-3xl text-white font-black mb-2">Answer Locked</h2>
                  <p className="text-slate-400 text-xl">Waiting for time to expire...</p>
                </div>
              ) : (
                <div className="flex-1 grid grid-cols-2 gap-4">
                  {(gameState.status === GAME_STATES.Q_ARTIST ? song.artistOptions : song.titleOptions).map((opt, i) => (
                    <button 
                      key={i} onClick={() => submitAnswer(opt)}
                      className={`${colors[i]} text-white font-black text-2xl rounded-2xl shadow-xl active:scale-95 transition-transform flex items-center justify-center p-4 text-center break-words`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {(gameState.status === GAME_STATES.REV_ARTIST || gameState.status === GAME_STATES.REV_TITLE) && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              {me?.lastPointsEarned > 0 ? (
                <div className="animate-in zoom-in duration-500">
                  <CheckCircle size={100} className="text-emerald-500 mx-auto mb-6 drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
                  <h2 className="text-5xl text-white font-black mb-4">Correct!</h2>
                  <div className="text-4xl text-emerald-400 font-black bg-emerald-900/30 px-6 py-3 rounded-2xl inline-block">
                    +{me.lastPointsEarned} pts
                  </div>
                </div>
              ) : (
                <div className="animate-in fade-in duration-500">
                  <div className="w-24 h-24 bg-red-900/40 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="text-5xl">❌</span>
                  </div>
                  <h2 className="text-4xl text-white font-black mb-3">Incorrect</h2>
                  <p className="text-slate-400 text-xl">Check the projector for the answer.</p>
                </div>
              )}
            </div>
          )}

          {gameState.status === GAME_STATES.LEADERBOARD && (
             <div className="flex-1 flex flex-col items-center justify-center text-center">
               <Trophy size={100} className="text-amber-400 mb-8 drop-shadow-[0_0_20px_rgba(251,191,36,0.4)]" />
               <h2 className="text-5xl text-white font-black mb-4">Game Over!</h2>
               <p className="text-slate-400 text-2xl">Look at the big screen for final results.</p>
             </div>
          )}
        </div>
      </div>
    );
  };

  const renderHostView = () => {
    const song = gameState.songs[gameState.currentSongIndex];
    const answersSubmittedCount = players.filter(p => p.currentAnswer).length;
    
    // Create the dynamic join URL that the QR code will point to
    const dynamicJoinUrl = `${window.location.origin}?pin=${gamePin}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(dynamicJoinUrl)}&bgcolor=ffffff&color=000000`;

    return (
      <div className="min-h-screen bg-slate-950 font-sans p-8 flex flex-col">
        <audio ref={audioRef} src={song?.url} preload="auto" />

        <header className="w-full flex items-center justify-between bg-slate-900 border-b-4 border-indigo-600 p-6 rounded-2xl mb-8 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="bg-indigo-600 p-3 rounded-xl"><Music className="text-white" size={36} /></div>
            <h1 className="text-4xl font-black text-white tracking-tight">AudioTrivia</h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right flex items-center gap-6 bg-slate-800 px-6 py-3 rounded-xl border border-slate-700">
               <div>
                 <div className="text-slate-400 text-lg font-bold uppercase tracking-wider mb-1">Backup PIN Code</div>
                 <div className="text-5xl font-black text-white font-mono tracking-widest">{gamePin}</div>
               </div>
            </div>
          </div>
        </header>

        {gameState.status === GAME_STATES.LOBBY && (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
            
            {/* Left Side: Massive QR Code for scanning */}
            <div className="bg-slate-800 p-10 rounded-3xl border border-slate-700 shadow-2xl flex flex-col items-center justify-center text-center">
              <h2 className="text-5xl font-black text-white mb-8">Scan to Join!</h2>
              <div className="bg-white p-6 rounded-3xl mb-8 shadow-[0_0_40px_rgba(79,70,229,0.3)]">
                <img src={qrImageUrl} alt="Scan to join" className="w-[400px] h-[400px] object-contain" />
              </div>
              <p className="text-2xl text-slate-400 flex items-center gap-3">
                 <QrCode size={32} /> Point your phone camera here
              </p>
            </div>

            {/* Right Side: Player Grid */}
            <div className="bg-slate-800 p-10 rounded-3xl border border-slate-700 shadow-2xl flex flex-col max-h-[75vh]">
              <div className="flex justify-between items-center mb-8 border-b border-slate-700 pb-6">
                 <h2 className="text-5xl font-bold text-white flex items-center gap-4">
                   <Users className="text-indigo-400" size={48} /> 
                   Players ({players.length})
                 </h2>
                 <button onClick={() => startPhase(GAME_STATES.Q_ARTIST)} disabled={players.length === 0} className="bg-emerald-600 disabled:bg-slate-700 hover:bg-emerald-500 text-white font-black py-5 px-10 rounded-2xl text-3xl shadow-xl transition transform active:scale-95">
                   Start Game
                 </button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar">
                {players.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 italic text-2xl">Waiting for players to scan...</div>
                ) : (
                  <div className="flex flex-wrap gap-4 content-start">
                    {players.map(p => (
                      <span key={p.id} className="bg-slate-700 text-white px-6 py-4 rounded-xl font-bold text-2xl border border-slate-600 shadow-md animate-in zoom-in">
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {(gameState.status === GAME_STATES.Q_ARTIST || gameState.status === GAME_STATES.Q_TITLE) && (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-800 rounded-3xl border border-slate-700 p-12 text-center relative overflow-hidden shadow-2xl">
            
            <div className="absolute top-10 left-10 flex items-center gap-3 text-slate-300 font-bold uppercase tracking-widest bg-slate-900 px-6 py-4 rounded-2xl text-2xl border border-slate-700 shadow-lg">
              <Users size={28} className="text-indigo-400" /> {answersSubmittedCount} / {players.length} Answers Locked
            </div>
            
            <div className="w-48 h-48 rounded-full border-[12px] border-indigo-500 flex items-center justify-center mb-10 shadow-[0_0_50px_rgba(99,102,241,0.3)] bg-slate-900">
              <span className="text-8xl text-white font-black font-mono tracking-tighter">{Math.ceil(timeLeft)}</span>
            </div>

            <h1 className="text-6xl lg:text-7xl font-black text-white mb-16 leading-tight">
              {gameState.status === GAME_STATES.Q_ARTIST ? "Listen closely...\nWho is the Artist?" : "Now listen longer...\nWhat is the Song Title?"}
            </h1>

            <div className="grid grid-cols-2 gap-8 w-full max-w-6xl mb-12">
              {(gameState.status === GAME_STATES.Q_ARTIST ? song.artistOptions : song.titleOptions).map((opt, i) => (
                <div key={i} className={`py-10 px-6 text-4xl font-black text-white rounded-2xl shadow-xl break-words flex items-center justify-center text-center
                  ${i===0 ? 'bg-red-600' : i===1 ? 'bg-blue-600' : i===2 ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                  {opt}
                </div>
              ))}
            </div>

            <button onClick={() => revealAndScore(gameState.status === GAME_STATES.Q_ARTIST ? GAME_STATES.REV_ARTIST : GAME_STATES.REV_TITLE)} 
                    className="absolute bottom-10 right-10 bg-slate-700 hover:bg-slate-600 text-white font-bold py-4 px-8 rounded-xl transition text-xl">
              Skip Timer
            </button>
          </div>
        )}

        {(gameState.status === GAME_STATES.REV_ARTIST || gameState.status === GAME_STATES.REV_TITLE) && (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-800 rounded-3xl border border-slate-700 p-12 text-center shadow-2xl">
            <h2 className="text-slate-400 font-black uppercase tracking-widest text-3xl mb-6">Correct Answer</h2>
            <h1 className="text-8xl font-black text-emerald-400 mb-16 drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              {gameState.status === GAME_STATES.REV_ARTIST ? song.artist : song.title}
            </h1>
            
            <div className="w-full max-w-4xl bg-slate-900 p-10 rounded-3xl border border-slate-700 mb-16 shadow-inner">
              <h3 className="text-3xl text-white font-black mb-8 flex items-center justify-center gap-3">
                <Trophy className="text-amber-400" size={36} /> Current Top 5
              </h3>
              <div className="space-y-4">
                {[...players].sort((a, b) => b.score - a.score).slice(0, 5).map((p, i) => (
                  <div key={p.id} className={`flex justify-between items-center p-5 rounded-xl border ${i === 0 ? 'bg-amber-900/20 border-amber-500/30' : 'bg-slate-800 border-slate-700'}`}>
                    <span className="text-white font-bold text-3xl flex items-center gap-4">
                      <span className={`w-12 text-center ${i === 0 ? 'text-amber-400' : 'text-slate-500'}`}>#{i+1}</span> 
                      {p.name}
                    </span>
                    <span className="text-indigo-400 font-black text-3xl">{p.score.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {gameState.status === GAME_STATES.REV_ARTIST ? (
              <button onClick={() => startPhase(GAME_STATES.Q_TITLE)} className="bg-blue-600 hover:bg-blue-500 text-white font-black py-6 px-16 rounded-2xl text-4xl shadow-xl transition transform active:scale-95">
                Proceed to Song Title (15s Clip)
              </button>
            ) : (
              <button onClick={nextRound} className="bg-indigo-600 hover:bg-indigo-500 text-white font-black py-6 px-16 rounded-2xl text-4xl shadow-xl transition transform active:scale-95">
                Start Next Round
              </button>
            )}
          </div>
        )}

        {gameState.status === GAME_STATES.LEADERBOARD && (
          <div className="flex-1 flex flex-col items-center justify-end bg-slate-800 rounded-3xl border border-slate-700 p-12 text-center shadow-2xl relative overflow-hidden">
             
             <div className="absolute top-20 w-full flex flex-col items-center">
               <Trophy size={160} className="text-amber-400 mb-8 drop-shadow-[0_0_40px_rgba(251,191,36,0.5)]" />
               <h1 className="text-8xl font-black text-white tracking-tight">Final Podium</h1>
             </div>
             
             <div className="flex items-end justify-center gap-10 h-96 mt-auto">
               {/* Podium logic: Top 3 */}
               {(() => {
                 const top3 = [...players].sort((a, b) => b.score - a.score).slice(0, 3);
                 return (
                   <>
                     {/* 2nd Place */}
                     {top3[1] && (
                       <div className="flex flex-col items-center animate-in slide-in-from-bottom duration-1000 delay-500 fill-mode-both">
                         <span className="text-4xl font-bold text-white mb-2">{top3[1].name}</span>
                         <span className="text-xl text-slate-400 font-bold mb-4">{top3[1].score.toLocaleString()} pts</span>
                         <div className="w-56 bg-gradient-to-b from-slate-300 to-slate-500 h-64 rounded-t-2xl flex items-start pt-6 justify-center shadow-2xl">
                           <span className="text-6xl font-black text-slate-700">2</span>
                         </div>
                       </div>
                     )}
                     
                     {/* 1st Place */}
                     {top3[0] && (
                       <div className="flex flex-col items-center animate-in slide-in-from-bottom duration-1000 delay-1000 fill-mode-both z-10">
                         <span className="text-6xl font-black text-amber-400 mb-2 drop-shadow-md">{top3[0].name}</span>
                         <span className="text-2xl text-amber-200 font-bold mb-4">{top3[0].score.toLocaleString()} pts</span>
                         <div className="w-64 bg-gradient-to-b from-amber-400 to-amber-600 h-80 rounded-t-2xl flex items-start pt-6 justify-center shadow-[0_0_50px_rgba(251,191,36,0.3)]">
                           <span className="text-8xl font-black text-amber-900 drop-shadow-sm">1</span>
                         </div>
                       </div>
                     )}
                     
                     {/* 3rd Place */}
                     {top3[2] && (
                       <div className="flex flex-col items-center animate-in slide-in-from-bottom duration-1000 delay-300 fill-mode-both">
                         <span className="text-3xl font-bold text-amber-700 mb-2">{top3[2].name}</span>
                         <span className="text-xl text-slate-500 font-bold mb-4">{top3[2].score.toLocaleString()} pts</span>
                         <div className="w-56 bg-gradient-to-b from-amber-700 to-amber-900 h-48 rounded-t-2xl flex items-start pt-6 justify-center shadow-2xl">
                           <span className="text-5xl font-black text-amber-950">3</span>
                         </div>
                       </div>
                     )}
                   </>
                 );
               })()}
             </div>
          </div>
        )}
      </div>
    );
  };

  if (!user) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white text-3xl font-bold">Connecting...</div>;
  if (!role) return renderLanding();
  if (!gameState) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white text-3xl font-bold">Syncing Room Data...</div>;
  if (role === 'player') return renderPlayerView();
  if (role === 'host') return renderHostView();
}