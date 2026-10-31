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
  window.paperbagMemberClient = client;
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

  // Public reduced previews; private originals require a permanent account choice.
  let galleryUser = null, galleryVersion = 0, catalog = [], choices = [], choosing = false;
  const galleryStatus = text => { if ($('wallpaper-status')) $('wallpaper-status').textContent = text; };
  const selected = id => choices.some(x => x.wallpaper_id === id);
  const readChoices = async user => {
    const {data, error} = await client.from('wallpaper_selections').select('wallpaper_id,slot').eq('user_id', user);
    if (error) throw error;
    return data || [];
  };
  const claim = async (item, user, version) => {
    // A unique account/slot constraint makes simultaneous requests share six slots.
    for (let attempt = 0; attempt < 7; attempt++) {
      const current = await readChoices(user);
      if (version !== galleryVersion || user !== galleryUser) throw new Error('Please sign in again.');
      choices = current;
      if (selected(item.id)) return;
      const slot = [1,2,3,4,5,6].find(n => !current.some(x => x.slot === n));
      if (!slot) throw new Error('You have chosen all 6 wallpapers. Your selected wallpapers remain available to download again.');
      const {error} = await client.from('wallpaper_selections').insert({user_id:user, wallpaper_id:item.id, slot});
      if (!error) { choices = [...current, {wallpaper_id:item.id, slot}]; return; }
      if (error.code !== '23505') throw new Error('Your choice could not be confirmed. Refresh wallpapers and try again.');
    }
    throw new Error('Your choices changed on another device. Refresh wallpapers and try again.');
  };
  const signed = async (path, download = false) => {
    const options = download ? {download: 'paperbagcrew-' + path.split('/').pop()} : {};
    const {data, error} = await client.storage.from('member-wallpapers').createSignedUrl(path, 300, options);
    if (error) throw new Error('Could not prepare the download. Your confirmed choice is saved; please try again.');
    const url = new URL(data.signedUrl);
    if (url.origin !== 'https://yliacgixfhjhgjemvbpg.supabase.co' || !url.pathname.startsWith('/storage/v1/object/sign/member-wallpapers/')) throw new Error('Invalid download URL.');
    return url.href;
  };
  const openWallpaper = async (item, download) => {
    if (!galleryUser || choosing) return;
    const version = galleryVersion, user = galleryUser;
    if (!selected(item.id)) {
      if (choices.length >= 6) { galleryStatus('All 6 choices used. Open My selections to download your chosen wallpapers.'); return; }
      if (!window.confirm('Choose “' + item.title + '” as one of your 6 free wallpapers?\n\nThis choice is permanent. You can download it again without using another choice.')) return;
    }
    // Reserve the window in the original tap event for iPhone popup handling.
    const tab = window.open('', '_blank');
    if (tab) { tab.opener = null; tab.document.title = 'Preparing your wallpaper'; tab.document.body.textContent = 'Preparing your wallpaper…'; }
    choosing = true; renderWallpapers(); galleryStatus('Preparing ' + item.title + '…');
    try {
      await claim(item, user, version);
      const url = await signed(item.object_path, download);
      if (version !== galleryVersion || galleryUser !== user) { if(tab) tab.close(); return; }
      if (tab) { tab.location.replace(url); galleryStatus('Ready. Your selection is saved. On iPhone, touch and hold the full-size image to save it to Photos, or check Files after downloading.'); }
      else {
        const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = 'Your selection is saved. Tap here to open your wallpaper'; $('wallpaper-status').replaceChildren(link);
      }
    } catch (error) {
      if (tab) tab.close();
      if (version === galleryVersion) galleryStatus(error.message || 'Please refresh wallpapers and try again.');
    } finally { choosing = false; if(version === galleryVersion) renderWallpapers(); }
  };
  const renderWallpapers = () => {
    if (!galleryUser) return;
    $('wallpaper-quota').textContent = choices.length + ' of 6 chosen · ' + Math.max(0,6-choices.length) + ' choices remaining';
    const group = $('wallpaper-collection').value, view = $('wallpaper-view').value, term = $('wallpaper-search').value.trim().toLowerCase();
    const items = catalog.filter(item => (group === 'all' || item.collection === group) && (view !== 'chosen' || selected(item.id)) && item.title.toLowerCase().includes(term));
    $('wallpaper-grid').replaceChildren();
    for (const item of items) {
      const chosen = selected(item.id);
      const card = document.createElement('article'); card.className = 'wallpaper-card'; card.id = 'artwork-' + item.gallery_id;
      const img = document.createElement('img'); img.alt = item.title + ' — reduced preview'; img.loading = 'lazy'; img.decoding = 'async';
      if (/^\/wallpapers\/assets\/[a-z0-9-]+\.webp$/.test(item.preview_url || '')) img.src = item.preview_url;
      const title = document.createElement('h3'); title.textContent = item.title;
      const caption = document.createElement('p'); caption.className = 'muted'; caption.textContent = item.collection + (chosen ? ' · Selected ✓' : ' · Uses 1 choice');
      const actions = document.createElement('div'); actions.className = 'wallpaper-actions';
      for (const [label,download] of (chosen ? [['Open full-size',false],['Download PNG',true]] : [[choices.length >= 6 ? 'All 6 choices used' : 'Choose this wallpaper',false]])) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.disabled = choosing || (!chosen && choices.length >= 6);
        button.onclick = () => openWallpaper(item, download); actions.append(button);
      }
      card.append(img,title,caption,actions); $('wallpaper-grid').append(card);
    }
    $('wallpaper-empty').hidden = items.length > 0;
  };
  const loadWallpapers = async version => {
    if (version !== galleryVersion || !galleryUser) return;
    galleryStatus('Loading your wallpapers…');
    try {
      const [result, current] = await Promise.all([
        client.from('wallpapers').select('id,title,object_path,preview_url,gallery_id,collection').eq('published',true).order('gallery_id'),
        readChoices(galleryUser)
      ]);
      if (result.error) throw result.error;
      if (version !== galleryVersion || !galleryUser) return;
      catalog = (result.data || []).sort((a,b) => Number(b.collection === 'Winter Collection') - Number(a.collection === 'Winter Collection') || a.gallery_id-b.gallery_id);
      choices = current; renderWallpapers(); galleryStatus(catalog.length + ' artworks to explore. Choose any 6 once; download your selections again anytime.');
      const requested = query.get('artwork');
      if (requested && /^\d+$/.test(requested)) $('artwork-' + requested)?.scrollIntoView({block:'center'});
      else if (location.hash === '#wallpapers') $('wallpapers').scrollIntoView();
    } catch (error) {
      if (version === galleryVersion) { catalog=[]; $('wallpaper-grid').replaceChildren(); galleryStatus('Wallpapers could not load. Use Refresh wallpapers to try again.'); }
    }
  };
  const syncWallpapers = session => {
    if (!$('wallpapers')) return;
    const user = !recovering && session && !session.user.is_anonymous ? session.user.id : null;
    $('wallpapers').hidden = !user;
    if (user === galleryUser) return;
    galleryUser = user; galleryVersion++; catalog=[]; choices=[];
    $('wallpaper-grid').replaceChildren(); galleryStatus('');
    if (user) { const version=galleryVersion; setTimeout(() => loadWallpapers(version),0); }
  };
  $('wallpaper-refresh').onclick = async () => {
    if(choosing) return;
    const {data,error}=await client.auth.getSession();
    if(error) { galleryStatus('Please refresh the page and sign in again.'); return; }
    galleryUser=null;syncWallpapers(data.session);
  };
  ['wallpaper-collection','wallpaper-view'].forEach(id => $(id).addEventListener('change',renderWallpapers));
  $('wallpaper-search').addEventListener('input',renderWallpapers);

  const showSession = session => {
    syncWallpapers(session);
    $('auth').hidden = Boolean(session);
    $('profile').hidden = !session || recovering;
    $('recovery').hidden = !session || !recovering;
    if (session) {
      if (!recovering && query.get('next') === 'city-sessions') { location.replace('/shop/city-sessions-vol-01/checkout/'); return; }
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
    document.querySelectorAll('#auth button, #profile button, #recovery button').forEach(b => b.disabled = true);
    message('Please wait…');
    try { await action(); }
    catch (error) { message(error.message || 'Something went wrong. Please try again.', true); }
    finally { busy = false; document.querySelectorAll('#auth button, #profile button, #recovery button').forEach(b => b.disabled = false); }
  };
  const check = result => { if (result.error) throw result.error; return result.data; };
  const email = () => {
    if (!$('email').reportValidity()) throw new Error('Enter a valid email address first.');
    return $('email').value.trim();
  };
  const mode = value => {
    signup = value; $('name-field').hidden = !value; $('name').required = value;
    $('password-hint').hidden = !value; $('password').minLength = value ? 8 : 1;
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
      history.replaceState(null, '', '/account/' + (query.has('artwork') ? '?artwork=' + encodeURIComponent(query.get('artwork')) : '') + (location.hash === '#wallpapers' ? '#wallpapers' : ''));
    } catch (error) { $('auth').hidden = false; message(error.message, true); }
  })();
})();
