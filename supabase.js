import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const $ = (id) => document.getElementById(id);
const KEY = 'studyflow.simple.v1';
const OWNER_KEY = 'studyflow.owner.v1';
let supabase = null;
let currentUser = null;
let saveTimer = null;
let syncing = false;

function status(message) { $('syncStatus').textContent = message; }
function accountMessage(message = '') { $('accountMessage').textContent = message; }
function localAssignments() {
  try { const value = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function setAccount(user) {
  currentUser = user || null;
  $('accountStatus').textContent = user ? `Signed in · ${user.email || 'Student account'}` : 'Not signed in · saved on this device';
  $('openAccount').classList.toggle('hidden', !!user);
  $('signOut').classList.toggle('hidden', !user);
  if (user) $('accountPanel').classList.add('hidden');
  status(user ? 'Connecting to your StudyFlow cloud storage…' : 'Your homework is saved on this device until you sign in.');
}
function showError(error) {
  const message = error?.message || 'Something went wrong. Please try again.';
  accountMessage(message);
  status(`Sync issue: ${message}`);
}
async function loadCloud() {
  if (!currentUser || syncing) return;
  syncing = true;
  try {
    const { data, error } = await supabase
      .from('student_assignments')
      .select('assignments')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) throw error;
    if (data && Array.isArray(data.assignments)) {
      window.studyflowApplyCloud(data.assignments);
    } else {
      // Only import local work if it is guest work or belongs to this same account.
      // This prevents one student's cached homework being copied into another account.
      const localOwner = localStorage.getItem(OWNER_KEY);
      const local = (!localOwner || localOwner === currentUser.id) ? localAssignments() : [];
      window.studyflowApplyCloud(local);
      if (local.length) await saveToCloud(local);
    }
    localStorage.setItem(OWNER_KEY, currentUser.id);
    status('✓ Synced. Your homework is available on your other devices.');
  } catch (error) { showError(error); }
  finally { syncing = false; }
}
async function saveToCloud(assignments) {
  if (!currentUser) return;
  const { error } = await supabase.from('student_assignments').upsert({
    user_id: currentUser.id,
    assignments,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) throw error;
}
function saveCloud(assignments) {
  if (!currentUser || !supabase) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveToCloud(assignments);
      status('✓ Changes saved to your StudyFlow account.');
    } catch (error) { status(`Could not sync: ${error.message}`); }
  }, 600);
}

$('openAccount').addEventListener('click', () => { $('accountPanel').classList.remove('hidden'); accountMessage(); });
$('closeAccount').addEventListener('click', () => $('accountPanel').classList.add('hidden'));
$('accountLogin').addEventListener('click', async () => {
  accountMessage();
  const email = $('accountEmail').value.trim();
  const password = $('accountPassword').value;
  if (!email || !password) { accountMessage('Enter your email and password.'); return; }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setAccount(data.user);
    await loadCloud();
  } catch (error) { showError(error); }
});
$('accountSignup').addEventListener('click', async () => {
  accountMessage();
  const email = $('accountEmail').value.trim();
  const password = $('accountPassword').value;
  if (!email || password.length < 8) { accountMessage('Enter an email and a password with at least 8 characters.'); return; }
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw error;
    if (data.session && data.user) {
      setAccount(data.user);
      await loadCloud();
    } else {
      accountMessage('Account created! Check your email to confirm it, then return here and sign in.');
    }
  } catch (error) { showError(error); }
});
$('signOut').addEventListener('click', async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setAccount(null);
    status('Signed out. This device still has its saved copy.');
  } catch (error) { showError(error); }
});

if (!SUPABASE_URL.startsWith('https://') || SUPABASE_PUBLISHABLE_KEY.startsWith('PASTE_')) {
  status('Add your Supabase Project URL and Publishable key in supabase-config.js, then redeploy.');
  $('openAccount').disabled = true;
  $('openAccount').textContent = 'Connect Supabase first';
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  window.studyflowCloud = { save: saveCloud };
  supabase.auth.getSession().then(async ({ data, error }) => {
    if (error) { showError(error); return; }
    setAccount(data.session?.user || null);
    if (data.session?.user) await loadCloud();
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const nextUser = session?.user || null;
    const changed = currentUser?.id !== nextUser?.id;
    setAccount(nextUser);
    if (changed && nextUser) loadCloud();
  });
}
