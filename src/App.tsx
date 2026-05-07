import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  signOut 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  updateDoc, 
  deleteDoc,
  doc, 
  serverTimestamp,
  increment,
  getDocFromServer
} from 'firebase/firestore';
import { 
  MessageSquare, 
  Hash, 
  Plus, 
  ThumbsUp, 
  ThumbsDown, 
  LogOut, 
  LogIn, 
  RefreshCcw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

// Test Connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or internet connection.");
    }
  }
}
testConnection();

// Types
interface Post {
  id: string;
  type: 'text' | 'hashtag';
  content: string;
  authorId: string;
  authorName: string;
  votesPour: number;
  votesContre: number;
  createdAt: any;
  status: 'pending' | 'approved' | 'rejected';
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'texts' | 'hashtags'>('all');
  const [votedPosts, setVotedPosts] = useState<Record<string, 'pour' | 'contre'>>({});
  const [selectedEntry, setSelectedEntry] = useState<Post | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currUser) => {
      setUser(currUser);
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  // Firestore Listener
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
      setPosts(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'posts');
    });
    return unsubscribe;
  }, [user]);

  // Load votes from localStorage (to prevent double voting in UI-only sense)
  useEffect(() => {
    const saved = localStorage.getItem('user_votes');
    if (saved) setVotedPosts(JSON.parse(saved));
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') return;
      console.error("Login Error:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const submitPost = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const form = e.currentTarget;
    const formData = new FormData(form);
    const content = formData.get('content') as string;
    const type = formData.get('type') as 'text' | 'hashtag';

    try {
      await addDoc(collection(db, 'posts'), {
        type,
        content: type === 'hashtag' ? content.toLowerCase().replace(/^#?/, '#') : content,
        authorId: user.uid,
        authorName: user.displayName,
        votesPour: 0,
        votesContre: 0,
        createdAt: serverTimestamp(),
        status: 'pending'
      });
      setIsSubmitModalOpen(false);
      form.reset();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'posts');
    }
  };

  const castVote = async (postId: string, type: 'pour' | 'contre') => {
    if (!user || votedPosts[postId]) return;

    const newVotes = { ...votedPosts, [postId]: type };
    setVotedPosts(newVotes);
    localStorage.setItem('user_votes', JSON.stringify(newVotes));

    try {
      const postRef = doc(db, 'posts', postId);
      await updateDoc(postRef, {
        [type === 'pour' ? 'votesPour' : 'votesContre']: increment(1)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `posts/${postId}`);
    }
  };

  const saveEntry = async (entry: Post) => {
    try {
      const { id, ...data } = entry;
      const postRef = doc(db, 'posts', id);
      await updateDoc(postRef, { ...data });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `posts/${entry.id}`);
    }
  };

  const deleteItem = async (postId: string) => {
    if (!window.confirm('Voulez-vous vraiment supprimer cette proposition ?')) return;
    try {
      await deleteDoc(doc(db, 'posts', postId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `posts/${postId}`);
    }
  };

  const filteredPosts = posts.filter(p => {
    if (activeTab === 'all') return true;
    if (activeTab === 'texts') return p.type === 'text';
    if (activeTab === 'hashtags') return p.type === 'hashtag';
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F6F5F0]">
        <RefreshCcw className="h-8 w-8 animate-spin text-[#185FA5]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F6F5F0] p-4 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md space-y-6"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#185FA5] text-white">
            <MessageSquare className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#1A1A18]">Social Media Hub</h1>
          <p className="text-[#6B6B67]">
            Connectez-vous pour partager vos idées et voter pour les meilleurs textes et hashtags.
          </p>
          <button 
            onClick={handleLogin}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#1A1A18] px-6 py-3 font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <LogIn className="h-5 w-5" />
            Se connecter avec Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="app-container min-h-screen bg-[#F6F5F0] font-sans">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-[rgba(0,0,0,0.1)] bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#185FA5] text-white">
            <MessageSquare className="h-6 w-6" />
          </div>
          <span className="text-lg font-bold tracking-tight">SocialValidator</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-3 md:flex">
            <span className="text-sm font-medium">{user.displayName}</span>
            <img src={user.photoURL || ''} alt="" className="h-8 w-8 rounded-full border border-[rgba(0,0,0,0.1)]" />
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 text-[#6B6B67] hover:text-[#A32D2D]"
            title="Déconnexion"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-2">
            {(['all', 'texts', 'hashtags'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
                  activeTab === tab 
                  ? 'bg-[#185FA5] text-white shadow-lg shadow-blue-900/20' 
                  : 'bg-white text-[#6B6B67] hover:bg-gray-50'
                }`}
              >
                {tab === 'all' ? 'Tous' : tab === 'texts' ? 'Textes' : 'Hashtags'}
              </button>
            ))}
          </div>

          <button 
            onClick={() => setIsSubmitModalOpen(true)}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#1A1A18] px-6 py-2.5 text-sm font-bold text-white shadow-xl shadow-black/10 transition-transform hover:scale-[1.05]"
          >
            <Plus className="h-4 w-4" />
            Nouvelle Proposition
          </button>
        </div>

        <div className="grid gap-6">
          <AnimatePresence mode="popLayout">
            {filteredPosts.map(post => {
              const total = post.votesPour + post.votesContre;
              const ratio = total > 0 ? (post.votesPour / total) * 100 : 0;
              const isConsensus = post.votesPour >= 3 && ratio >= 70;
              const isDisagreement = post.votesContre > post.votesPour && post.votesContre >= 3;

              return (
                <motion.div
                  layout
                  key={post.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="group relative flex flex-col gap-4 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-6 transition-all hover:shadow-xl hover:shadow-black/5"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                        post.type === 'text' ? 'bg-[#E6F1FB] text-[#185FA5]' : 'bg-[#EEEDFE] text-[#534AB7]'
                      }`}>
                        {post.type === 'text' ? <MessageSquare className="h-5 w-5" /> : <Hash className="h-5 w-5" />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-[#1A1A18]">{post.authorName}</div>
                        <div className="text-xs text-[#6B6B67]">
                          {post.createdAt?.toDate?.() ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(post.createdAt.toDate()) : 'À l\'instant'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isConsensus && (
                        <div className="flex items-center gap-1.5 rounded-full bg-[#EAF3DE] px-3 py-1 text-[10px] font-bold text-[#639922]">
                          <CheckCircle2 className="h-3 w-3" />
                          CONSENSUS
                        </div>
                      )}
                      {isDisagreement && (
                        <div className="flex items-center gap-1.5 rounded-full bg-[#FCEBEB] px-3 py-1 text-[10px] font-bold text-[#A32D2D]">
                          <AlertCircle className="h-3 w-3" />
                          DÉSACCORD
                        </div>
                      )}
                      {post.authorId === user.uid && (
                        <div className="flex gap-1 ml-2">
                          <button 
                            onClick={() => { setSelectedEntry(post); setIsFormOpen(true); }}
                            className="p-1 text-[#6B6B67] hover:text-[#185FA5]"
                            title="Modifier"
                          >
                            <RefreshCcw className="h-3.5 w-3.5" />
                          </button>
                          <button 
                            onClick={() => deleteItem(post.id)}
                            className="p-1 text-[#6B6B67] hover:text-[#A32D2D]"
                            title="Supprimer"
                          >
                            <LogOut className="h-3.5 w-3.5 rotate-180" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={`text-lg leading-relaxed ${post.type === 'hashtag' ? 'font-mono text-[#534AB7]' : 'text-[#1A1A18]'}`}>
                    {post.content}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-gray-50 pt-4">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => castVote(post.id, 'pour')}
                          disabled={!!votedPosts[post.id]}
                          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition-all ${
                            votedPosts[post.id] === 'pour' 
                            ? 'bg-[#EAF3DE] text-[#639922]' 
                            : 'hover:bg-gray-100'
                          } ${votedPosts[post.id] ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          <ThumbsUp className="h-4 w-4" />
                          <span className="text-sm font-bold">{post.votesPour}</span>
                        </button>
                        <button 
                          onClick={() => castVote(post.id, 'contre')}
                          disabled={!!votedPosts[post.id]}
                          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition-all ${
                            votedPosts[post.id] === 'contre' 
                            ? 'bg-[#FCEBEB] text-[#A32D2D]' 
                            : 'hover:bg-gray-100'
                          } ${votedPosts[post.id] ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          <ThumbsDown className="h-4 w-4" />
                          <span className="text-sm font-bold">{post.votesContre}</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-[10px] font-bold text-[#6B6B67] uppercase tracking-wider">Engagement</div>
                      <div className="relative h-2 w-24 overflow-hidden rounded-full bg-gray-100">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${ratio}%` }}
                          className={`h-full ${ratio >= 70 ? 'bg-[#639922]' : ratio >= 40 ? 'bg-[#185FA5]' : 'bg-[#A32D2D]'}`}
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {filteredPosts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 rounded-full bg-white p-6 shadow-sm">
                <Plus className="h-12 w-12 text-gray-200" />
              </div>
              <h3 className="text-lg font-bold">Aucune proposition</h3>
              <p className="text-sm text-[#6B6B67]">Soyez le premier à partager un texte ou un hashtag !</p>
            </div>
          )}
        </div>
      </main>

      {/* Modal Submit/Edit */}
      <AnimatePresence>
        {(isSubmitModalOpen || isFormOpen) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsSubmitModalOpen(false); setIsFormOpen(false); setSelectedEntry(null); }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white p-8 shadow-2xl"
            >
              <h2 className="mb-6 text-xl font-bold">{selectedEntry ? "Modifier la Proposition" : "Nouvelle Publication"}</h2>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const formData = new FormData(form);
                const content = formData.get('content') as string;
                const type = formData.get('type') as 'text' | 'hashtag';
                
                if (selectedEntry) {
                   await saveEntry({ 
                     ...selectedEntry, 
                     content: type === 'hashtag' ? content.toLowerCase().replace(/^#?/, '#') : content,
                     type 
                   });
                   setIsFormOpen(false);
                   setSelectedEntry(null);
                } else {
                   await submitPost(e);
                }
              }} className="space-y-6">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6B6B67]">Type</label>
                  <div className="flex gap-2">
                    <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[rgba(0,0,0,0.1)] p-3 transition-colors has-[:checked]:border-[#185FA5] has-[:checked]:bg-[#E6F1FB] has-[:checked]:text-[#185FA5]">
                      <input type="radio" name="type" value="text" defaultChecked={!selectedEntry || selectedEntry.type === 'text'} className="hidden" />
                      <MessageSquare className="h-4 w-4" />
                      <span className="text-sm font-bold">Texte</span>
                    </label>
                    <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[rgba(0,0,0,0.1)] p-3 transition-colors has-[:checked]:border-[#534AB7] has-[:checked]:bg-[#EEEDFE] has-[:checked]:text-[#534AB7]">
                      <input type="radio" name="type" value="hashtag" defaultChecked={selectedEntry?.type === 'hashtag'} className="hidden" />
                      <Hash className="h-4 w-4" />
                      <span className="text-sm font-bold">Hashtag</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6B6B67]">Contenu</label>
                  <textarea 
                    name="content"
                    required
                    rows={4}
                    defaultValue={selectedEntry?.content}
                    placeholder="Qu'avez-vous en tête ?"
                    className="w-full rounded-2xl border border-[rgba(0,0,0,0.1)] bg-gray-50 p-4 text-sm focus:border-[#185FA5] focus:outline-none"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button" 
                    onClick={() => { setIsSubmitModalOpen(false); setIsFormOpen(false); setSelectedEntry(null); }}
                    className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-bold text-[#6B6B67] hover:bg-gray-200"
                  >
                    Annuler
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 rounded-xl bg-[#1A1A18] py-3 text-sm font-bold text-white shadow-lg shadow-black/20 hover:bg-black"
                  >
                    {selectedEntry ? "Mettre à jour" : "Publier"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
