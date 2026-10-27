(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const accountPage = Boolean($('auth-form'));
  const callback = 'https://paperbagcrew.com/account/';
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  // Forward callbacks before an SDK consumes the fragment on the homepage.
  if (!accountPage && (hash.has('access_token') || hash.has('error_description') || query.has('code'))) {
    location.replace('/account/' + location.search + location.hash); return;
  }
  const message = (value = '', error = false) => {
    if (!$('status')) return;
    $('status').textContent = value;
    $('status').dataset.error = String(error);
  };
  if (!window.supabase) { message('Account services could not load. Please refresh the page or check your connection.', true); return; }
  const client = window.supabase.createClient('https://yliacgixfhjhgjemvbpg.supabase.co', 'sb_publishable_MTi1uzs0XQMy9R6CfAYVHQ_5TDgjltp', {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });
  if (!accountPage) {
    client.auth.getSession().then(({data, error}) => {
      if (!error && data.session) {
        const link = document.querySelector('[data-member-link]');
        if (link) link.textContent = 'My account';
        if (!query.has('browse')) location.replace('/account/');
      }
    }).catch(() => {});
    return;
  }
  let signup = false, busy = false, recovering = hash.get('type') === 'recovery';
  const showSession = session => {
    $('auth').hidden = Boolean(session);
    $('profile').hidden = !session || recovering;
    $('recovery').hidden = !session || !recovering;
    if (session) {
      const name = session.user.user_metadata?.display_name || '';
      $('welcome').textContent = name ? 'Welcome, ' + name + '.' : 'Welcome back.';
      $('profile-name').value = name;
      $('member-email').textContent = session.user.email || '';
    }
  };
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    if (event === 'SIGNED_OUT') recovering = false;
    showSession(session);
  });
  const run = async action => {
    if (busy) return;
    busy = true;
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    message('Please wait…');
    try { await action(); }
    catch (error) { message(error.message || 'Something went wrong. Please try again.', true); }
    finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
  };
  const check = result => { if (result.error) throw result.error; return result.data; };
  const email = () => {
    if (!$('email').reportValidity()) throw new Error('Enter a valid email address first.');
    return $('email').value.trim();
  };
  const mode = value => {
    signup = value; $('name-field').hidden = !value; $('name').required = value;
    $('password-hint').hidden = !value; $('password').minLength = value ? 12 : 1;
    $('password').autocomplete = value ? 'new-password' : 'current-password';
    $('submit').textContent = value ? 'Create account' : 'Sign in';
    $('signup-tab').setAttribute('aria-pressed', String(value));
    $('login-tab').setAttribute('aria-pressed', String(!value)); message();
  };
  $('signup-tab').onclick = () => mode(true);
  $('login-tab').onclick = () => mode(false);
  $('auth-form').onsubmit = event => { event.preventDefault(); run(async () => {
    const credentials = {email: email(), password: $('password').value};
    if (signup) {
      const name = $('name').value.trim();
      if (!name) throw new Error('Please enter a nickname.');
      const data = check(await client.auth.signUp({...credentials, options: {emailRedirectTo: callback, data: {display_name: name}}}));
      $('password').value = '';
      message(data.session ? 'Your account is ready.' : 'Check your inbox and spam folder for a verification link. If you already have an account, sign in or reset your password.');
      showSession(data.session);
    } else {
      const data = check(await client.auth.signInWithPassword(credentials));
      $('password').value = ''; message('You are signed in.'); showSession(data.session);
    }
  }); };
  let nextEmailAt = 0;
  const sendEmail = action => run(async () => {
    if (Date.now() < nextEmailAt) throw new Error('Please wait one minute before requesting another email.');
    await action(); nextEmailAt = Date.now() + 60000;
  });
  $('resend').onclick = () => sendEmail(async () => {
    check(await client.auth.resend({type: 'signup', email: email(), options: {emailRedirectTo: callback}}));
    message('If this account needs verification, a new link has been requested. Check your inbox and spam folder.');
  });
  $('forgot').onclick = () => sendEmail(async () => {
    check(await client.auth.resetPasswordForEmail(email(), {redirectTo: callback}));
    message('If this email has an account, a password reset link has been requested. Check your inbox.');
  });
  $('profile-form').onsubmit = event => { event.preventDefault(); run(async () => {
    const name = $('profile-name').value.trim();
    if (!name) throw new Error('Please enter a nickname.');
    check(await client.auth.updateUser({data: {display_name: name}}));
    $('welcome').textContent = 'Welcome, ' + name + '.'; message('Profile saved.');
  }); };
  $('signout').onclick = () => run(async () => { check(await client.auth.signOut({scope: 'local'})); showSession(null); message('You are signed out on this device.'); });
  $('recovery-form').onsubmit = event => { event.preventDefault(); run(async () => {
    const password = $('new-password').value;
    if (password !== $('confirm-password').value) throw new Error('The passwords do not match.');
    check(await client.auth.updateUser({password})); recovering = false;
    $('new-password').value = ''; $('confirm-password').value = '';
    const data = check(await client.auth.getSession()); showSession(data.session); message('Your password has been updated.');
  }); };
  (async () => {
    try {
      const data = check(await client.auth.getSession()); showSession(data.session);
      if (hash.has('error_description')) message(hash.get('error_description') + ' Request a new email below.', true);
      else message();
      history.replaceState(null, '', '/account/');
    } catch (error) { $('auth').hidden = false; message(error.message, true); }
  })();
})();
