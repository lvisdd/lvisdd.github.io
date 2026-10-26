(() => {
  'use strict';
  const list = document.getElementById('game-list');
  for (const [index, game] of (window.GAME_CATALOG || []).entries()) {
    // Public catalog links remain inside this static site.
    if (!/^\.\/[a-z0-9][a-z0-9-]*\/$/.test(game.path)) continue;
    const card = document.createElement('article');
    card.className = 'game-card';
    const artwork = document.createElement('div');
    artwork.className = 'game-art';
    artwork.setAttribute('aria-hidden', 'true');
    const mark = document.createElement('span');
    mark.className = 'game-mark';
    mark.textContent = String(index + 1).padStart(2, '0');
    const word = document.createElement('span');
    word.className = 'game-word';
    word.textContent = game.label || game.title;
    artwork.append(mark, word);
    const body = document.createElement('div');
    body.className = 'game-body';
    const label = document.createElement('p');
    label.className = 'eyebrow';
    label.textContent = 'BROWSER GAME';
    const title = document.createElement('h3');
    title.textContent = game.title;
    const description = document.createElement('p');
    description.className = 'game-description';
    description.textContent = game.description;
    const link = document.createElement('a');
    link.className = 'play';
    link.href = game.path;
    link.textContent = 'ゲームを開く ↗';
    link.setAttribute('aria-label', `${game.title} のゲームページを開く`);
    body.append(label, title, description, link);
    card.append(artwork, body);
    list.append(card);
  }
})();
