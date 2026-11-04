const CONTACT = {
  whatsappNumber: "",
  whatsappLabel: "WhatsApp no configurado",
  email: "posventa@cigue.com.ar",
};

const FILTERS = [
  { label: "Todos", value: "todos" },
  { label: "Camiones", value: "camiones" },
  { label: "Vans", value: "vans" },
  { label: "Repuestos", value: "repuestos" },
  { label: "Accesorios", value: "accesorios" },
  { label: "Lubricantes", value: "lubricantes" },
  { label: "Ofertas", value: "ofertas" },
];

const state = {
  products: [],
  activeFilter: "todos",
  search: "",
};

const productGrid = document.querySelector("#productGrid");
const filters = document.querySelector("#filters");
const searchInput = document.querySelector("#searchInput");
const emptyState = document.querySelector("#emptyState");
const catalogCount = document.querySelector("#catalogCount");

function escapeHtml(value) {
  return value
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function encodeMessage(message) {
  return encodeURIComponent(message);
}

function getWhatsappUrl(productName = "") {
  const message = productName
    ? `Hola, quiero consultar por ${productName} publicado en el Catálogo de Posventa de Cigliutti Guerini.`
    : "Hola, quiero consultar por productos publicados en el Catálogo de Posventa de Cigliutti Guerini.";

  return CONTACT.whatsappNumber ? `https://wa.me/${CONTACT.whatsappNumber}?text=${encodeMessage(message)}` : "#contacto";
}

function getMailUrl(productName = "") {
  const subject = productName ? `Consulta por ${productName}` : "Consulta Catálogo de Posventa";
  const body = productName
    ? `Hola, quiero recibir más información sobre ${productName} publicado en el Catálogo de Posventa de Cigliutti Guerini.`
    : "Hola, quiero recibir más información sobre productos publicados en el Catálogo de Posventa de Cigliutti Guerini.";

  return `mailto:${CONTACT.email}?subject=${encodeMessage(subject)}&body=${encodeMessage(body)}`;
}

function formatPrice(price) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(price);
}

function normalize(value) {
  return value
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function productMatchesFilter(product) {
  if (state.activeFilter === "todos") return true;
  if (state.activeFilter === "ofertas") return normalize(product.badge || "") === "oferta";

  const application = normalize(product.application);
  const category = normalize(product.category);
  return application.includes(state.activeFilter) || category === state.activeFilter;
}

function getVisibleProducts() {
  const query = normalize(state.search.trim());

  return state.products.filter((product) => {
    const searchableText = [product.name, product.description, product.application, product.category, ...(product.models || [])]
      .join(" ");
    const matchesSearch = !query || normalize(searchableText).includes(query);
    return matchesSearch && productMatchesFilter(product);
  });
}

function renderFilters() {
  filters.innerHTML = FILTERS.map(
    (filter) => `
      <button
        class="filter-button ${filter.value === state.activeFilter ? "is-active" : ""}"
        type="button"
        data-filter="${filter.value}"
        aria-pressed="${filter.value === state.activeFilter}"
      >
        ${filter.label}
      </button>
    `
  ).join("");
}

function renderProducts() {
  const products = getVisibleProducts();
  catalogCount.textContent = `${products.length} producto${products.length === 1 ? "" : "s"}`;
  emptyState.hidden = products.length > 0;

  productGrid.innerHTML = products
    .map((product) => {
      const badgeClass = product.badge ? `is-${normalize(product.badge)}` : "";
      const badge = product.badge
        ? `<span class="badge ${badgeClass}">${escapeHtml(product.badge)}</span>`
        : "";
      const soldBadge = product.sold ? `<span class="badge badge-sold">Vendido</span>` : "";
      const stockLabel = Number(product.stock || 0) > 0 ? `${Number(product.stock)} disponibles` : "Consultar disponibilidad";
      const actions = product.sold
        ? `<p class="sold-note">Este producto figura como vendido. Consultá por disponibilidad o alternativas.</p>`
        : `
            <a class="button button-whatsapp" href="${getWhatsappUrl(product.name)}" target="_blank" rel="noreferrer">
              Consultar por WhatsApp
            </a>
            <a class="button button-light" href="${getMailUrl(product.name)}">
              Consultar por mail
            </a>
          `;

      return `
        <article class="product-card ${product.sold ? "is-sold" : ""}">
          ${badge}
          ${soldBadge}
          <img class="product-image" src="${escapeHtml(product.image || 'assets/product-placeholder.svg')}" alt="${escapeHtml(product.name)}" onerror="this.onerror=null;this.src='assets/product-placeholder.svg'" />
          <div class="product-body">
            <h3>${escapeHtml(product.name)}</h3>
            <div class="product-meta">
              <span>Categoría: ${escapeHtml(product.category)}</span>
              <span>Aplicación: ${escapeHtml(product.application)}</span>
              <span>Modelos: ${escapeHtml((product.models || []).join(", ") || "Consultar")}</span>
            </div>
            <p class="product-description">${escapeHtml(product.description)}</p>
            <div class="product-price">${formatPrice(product.price)}</div>
            <div class="product-stock">${stockLabel}</div>
            <div class="product-actions">
              ${actions}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function bindEvents() {
  filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;

    state.activeFilter = button.dataset.filter;
    renderFilters();
    renderProducts();
  });

  searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderProducts();
  });
}

function setupContactLinks() {
  const whatsappLinks = ["#floatingWhatsapp", "#contactWhatsapp"];
  whatsappLinks.forEach((selector) => {
    const link = document.querySelector(selector);
    link.href = getWhatsappUrl();
    link.hidden = !CONTACT.whatsappNumber;
  });

  document.querySelector('.contact-item[href^="mailto:"]').href = getMailUrl();
  document.querySelector("#whatsappLabel").textContent = CONTACT.whatsappLabel;
}

async function init() {
  try {
    const configResponse = await fetch('/api/config');
    if (configResponse.ok) Object.assign(CONTACT, await configResponse.json());
  } catch {}
  setupContactLinks();
  bindEvents();
  renderFilters();

  try {
    let payload = null;
    try {
      const response = await fetch("/api/products");
      if (response.ok) {
        payload = await response.json();
      }
    } catch {}

    if (!payload) {
      const fallbackResponse = await fetch("products.json");
      if (!fallbackResponse.ok) throw new Error("No se pudo cargar el catálogo");
      payload = await fallbackResponse.json();
    }

    state.products = Array.isArray(payload) ? payload : (payload.products || []);
    renderProducts();
  } catch (error) {
    productGrid.innerHTML = "";
    emptyState.hidden = false;
    emptyState.textContent =
      "No se pudo cargar el catálogo. Revisá la conexión o los archivos del sitio.";
    console.error(error);
  }
}

init();
