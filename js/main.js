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

// Articles page (articles.html)
const latestGrid = document.getElementById('latest-articles-grid');
const archiveSection = document.getElementById('articles-archive');

if (latestGrid && archiveSection) {
  fetch('articles/index.json')
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(({ articles }) => {
      const all = articles || [];

      // --- Latest 3 cards ---
      const latest = all.slice(0, 3);
      if (!latest.length) {
        latestGrid.innerHTML = '<p class="articles-empty">No articles yet — check back soon.</p>';
      } else {
        latestGrid.innerHTML = latest.map(({ slug, title, excerpt }) => `
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
      }

      // --- Archive: group by year → month ---
      if (all.length <= 3) {
        archiveSection.hidden = true;
        return;
      }

      const MONTHS = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

      // Group all articles (including those in latest) into year→month buckets
      const grouped = {};
      all.forEach(article => {
        const d = new Date(article.publishedAt);
        const year = d.getFullYear();
        const month = d.getMonth(); // 0-indexed
        if (!grouped[year]) grouped[year] = {};
        if (!grouped[year][month]) grouped[year][month] = [];
        grouped[year][month].push(article);
      });

      // Render newest year first
      const years = Object.keys(grouped).map(Number).sort((a, b) => b - a);

      archiveSection.innerHTML = `
        <h2 class="archive-heading">Archive</h2>
        ${years.map((year, yi) => {
          const months = Object.keys(grouped[year]).map(Number).sort((a, b) => b - a);
          return `
            <details class="archive-year" ${yi === 0 ? 'open' : ''}>
              <summary class="archive-year-summary">${year}</summary>
              <div class="archive-year-body">
                ${months.map((month, mi) => {
                  const items = grouped[year][month];
                  return `
                    <details class="archive-month" ${yi === 0 && mi === 0 ? 'open' : ''}>
                      <summary class="archive-month-summary">${MONTHS[month]}</summary>
                      <ul class="archive-article-list">
                        ${items.map(({ slug, title }) => `
                          <li><a href="articles/${slug}.html">${title}</a></li>
                        `).join('')}
                      </ul>
                    </details>
                  `;
                }).join('')}
              </div>
            </details>
          `;
        }).join('')}
      `;
    })
    .catch(() => {
      if (latestGrid) latestGrid.innerHTML = '<p class="articles-empty">Articles coming soon.</p>';
    });
}
