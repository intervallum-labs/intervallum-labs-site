// Mobile nav toggle
const hamburger = document.querySelector('.nav-hamburger');
const navLinksWrap = document.querySelector('.nav-links-wrap');

if (hamburger && navLinksWrap) {
  hamburger.addEventListener('click', () => {
    const isOpen = navLinksWrap.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', String(isOpen));
  });

  // Close on link click
  navLinksWrap.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinksWrap.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!hamburger.contains(e.target) && !navLinksWrap.contains(e.target)) {
      navLinksWrap.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    }
  });
}

// Photo fallback: if josh.jpg is missing, show initials placeholder
document.querySelectorAll('img[data-fallback]').forEach(img => {
  img.addEventListener('error', () => {
    img.style.display = 'none';
    const fallback = img.nextElementSibling;
    if (fallback) fallback.style.display = 'flex';
  });
});

// Newsletter forms — placeholder handler (replace with real service embed)
document.querySelectorAll('.newsletter-form').forEach(form => {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const input = form.querySelector('input[type="email"]');
    if (input && input.value) {
      const btn = form.querySelector('button');
      btn.textContent = 'Thanks! ✓';
      btn.style.background = '#2A3D35';
      input.value = '';
      setTimeout(() => {
        btn.textContent = 'Subscribe →';
        btn.style.background = '';
      }, 3000);
    }
  });
});

// Dynamic latest articles (index.html)
const articlesGrid = document.getElementById('articles-grid');
if (articlesGrid) {
  fetch('articles/index.json')
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(({ articles }) => {
      const latest = (articles || []).slice(0, 3);
      if (!latest.length) {
        articlesGrid.innerHTML = '<p class="articles-empty">No articles yet — check back soon.</p>';
        return;
      }
      articlesGrid.innerHTML = latest.map(({ slug, title, excerpt }) => `
        <article class="article-card">
          <div class="article-card-top">
            <span class="article-tag">Article</span>
          </div>
          <div class="article-card-body">
            <h3>${title}</h3>
            ${excerpt ? `<p>${excerpt}</p>` : ''}
            <a href="articles/${slug}.html" class="article-read-link">Read article →</a>
          </div>
        </article>
      `).join('');
    })
    .catch(() => {
      articlesGrid.innerHTML = '<p class="articles-empty">Articles coming soon.</p>';
    });
}

// Articles filter buttons (articles.html)
const filterBtns = document.querySelectorAll('.filter-btn');
const articleCards = document.querySelectorAll('.article-card[data-category]');

if (filterBtns.length && articleCards.length) {
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const category = btn.dataset.filter;
      articleCards.forEach(card => {
        if (category === 'all' || card.dataset.category === category) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });
}
