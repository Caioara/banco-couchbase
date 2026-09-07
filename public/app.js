const userArea = document.getElementById("user-area");
const userPill = document.getElementById("user-pill");
const logoutBtn = document.getElementById("logout-btn");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginMessage = document.getElementById("login-message");
const registerMessage = document.getElementById("register-message");
const eventForm = document.getElementById("event-form");
const eventMessage = document.getElementById("event-message");
const eventsList = document.getElementById("events-list");
const myEventsList = document.getElementById("my-events-list");
const myEnrollmentsList = document.getElementById("my-enrollments-list");
const remindersList = document.getElementById("reminders-list");
const dashboard = document.getElementById("dashboard");
const createEventCard = document.getElementById("create-event-card");
const myEventsCard = document.getElementById("my-events-card");
const allEnrollmentsCard = document.getElementById("all-enrollments-card");
const allEnrollmentsList = document.getElementById("all-enrollments-list");
const searchInput = document.getElementById("search-input");
const fromDate = document.getElementById("from-date");
const toDate = document.getElementById("to-date");
const searchBtn = document.getElementById("search-btn");
const scrollEvents = document.getElementById("scroll-events");
const scrollAuth = document.getElementById("scroll-auth");

let currentUser = null;
let eventsPage = 0;
let eventsTotal = 0;
const eventsLimit = 10;

function setMessage(target, text, isSuccess = false) {
  target.textContent = text;
  target.classList.toggle("success", isSuccess);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = data.error || "Erro inesperado.";
    throw new Error(error);
  }

  return response.json();
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function renderEvents(list, target, options = {}) {
  target.innerHTML = "";
  if (!list.length) {
    target.innerHTML = "<p class=\"empty\">Nenhum evento encontrado.</p>";
    return;
  }

  list.forEach((item) => {
    const card = document.createElement("div");
    card.className = "event-card";

    const enrollButton = options.canEnroll
      ? `<button data-action="enroll" data-id="${item.id}" class="primary">Inscrever</button>`
      : "";

    const cancelButton = options.canCancel
      ? `<button data-action="cancel" data-id="${item.id}" class="ghost">Cancelar</button>`
      : "";

    const statusTag = item.status && item.status !== "open" ? ` - ${item.status}` : "";

    card.innerHTML = `
      <div class="event-header">
        <div>
          <h4>${item.title}${statusTag}</h4>
          <p>${item.location || "Local nao informado"}</p>
        </div>
        <span class="badge">${item.capacity} vagas</span>
      </div>
      <p>${item.description || "Sem descricao"}</p>
      <p><strong>Inicio:</strong> ${formatDate(item.startAt)} | <strong>Duracao:</strong> ${item.durationMinutes} min</p>
      <div class="event-actions">
        ${enrollButton}
        ${cancelButton}
      </div>
    `;

    target.appendChild(card);
  });
}

function renderEnrollments(items) {
  myEnrollmentsList.innerHTML = "";
  if (!items.length) {
    myEnrollmentsList.innerHTML = "<p class=\"empty\">Sem inscricoes ativas.</p>";
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "event-card";
    const statusTag = item.status !== "active" ? ` - ${item.status}` : "";

    card.innerHTML = `
      <div class="event-header">
        <div>
          <h4>${item.event.title}${statusTag}</h4>
          <p>${item.event.location || "Local nao informado"}</p>
        </div>
        <span class="badge">${item.event.capacity} vagas</span>
      </div>
      <p>${item.event.description || "Sem descricao"}</p>
      <p><strong>Inicio:</strong> ${formatDate(item.event.startAt)}</p>
      <div class="event-actions">
        <button data-action="cancel-enrollment" data-id="${item.id}" class="ghost">Cancelar inscricao</button>
      </div>
    `;

    myEnrollmentsList.appendChild(card);
  });
}

function renderReminders(items) {
  remindersList.innerHTML = "";
  if (!items.length) {
    remindersList.innerHTML = "<p class=\"empty\">Sem lembretes nas proximas 24h.</p>";
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "event-card";
    card.innerHTML = `
      <h4>${item.event.title}</h4>
      <p>${item.event.location || "Local nao informado"}</p>
      <p><strong>Inicio:</strong> ${formatDate(item.event.startAt)}</p>
    `;
    remindersList.appendChild(card);
  });
}

function renderAllEnrollments(items) {
  allEnrollmentsList.innerHTML = "";
  if (!items.length) {
    allEnrollmentsList.innerHTML = "<p class=\"empty\">Nenhuma inscricao registrada.</p>";
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div>
        <strong>Cliente</strong>
        <span>${item.user.name} (${item.user.email})</span>
      </div>
      <div>
        <strong>Evento</strong>
        <span>${item.event.title}</span>
        <div class="muted">${formatDate(item.event.startAt)}</div>
      </div>
      <div>
        <strong>Status</strong>
        <span>${item.status}</span>
      </div>
      <div>
        <strong>Inscricao</strong>
        <span>${formatDate(item.createdAt)}</span>
      </div>
    `;
    allEnrollmentsList.appendChild(row);
  });
}

function updateUI() {
  if (currentUser) {
    userPill.textContent = `${currentUser.name} (${currentUser.role})`;
    logoutBtn.hidden = false;
    dashboard.hidden = false;
    createEventCard.hidden = !(currentUser.role === "admin" || currentUser.role === "professional");
    myEventsCard.hidden = !(currentUser.role === "admin" || currentUser.role === "professional");
    allEnrollmentsCard.hidden = !(currentUser.role === "admin" || currentUser.role === "professional");
  } else {
    userPill.textContent = "Visitante";
    logoutBtn.hidden = true;
    dashboard.hidden = true;
  }
}

async function loadSession() {
  const data = await request("/api/auth/me");
  currentUser = data.user;
  updateUI();
}

function updatePagination(total) {
  eventsTotal = total;
  const pages = Math.max(1, Math.ceil(total / eventsLimit));
  const currentPage = Math.min(eventsPage + 1, pages);

  const from = total === 0 ? 0 : (currentPage - 1) * eventsLimit + 1;
  const to = Math.min(total, currentPage * eventsLimit);

  const pagination = document.getElementById("events-pagination");
  const info = document.getElementById("events-pagination-info");
  info.textContent = `${from}-${to} de ${total} | Pagina ${currentPage} de ${pages}`;
  pagination.hidden = total <= eventsLimit;

  document.getElementById("events-prev").disabled = currentPage <= 1;
  document.getElementById("events-next").disabled = currentPage >= pages;
}

async function loadEvents() {
  const params = new URLSearchParams();
  if (searchInput.value) params.set("q", searchInput.value);
  if (fromDate.value) params.set("from", new Date(fromDate.value).toISOString());
  if (toDate.value) params.set("to", new Date(toDate.value).toISOString());
  params.set("limit", String(eventsLimit));
  params.set("offset", String(eventsPage * eventsLimit));

  let data = await request(`/api/events?${params.toString()}`);
  if (data.items.length === 0 && data.total > 0) {
    eventsPage = Math.max(0, Math.ceil(data.total / eventsLimit) - 1);
    params.set("offset", String(eventsPage * eventsLimit));
    data = await request(`/api/events?${params.toString()}`);
  }
  const canEnroll = currentUser && currentUser.role === "client";
  renderEvents(data.items, eventsList, { canEnroll });
  updatePagination(data.total);
}

async function loadMyEvents() {
  if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "professional")) {
    return;
  }
  const data = await request("/api/events/mine");
  renderEvents(data.items, myEventsList, { canCancel: true });
}

async function loadEnrollments() {
  if (!currentUser) return;
  const data = await request("/api/enrollments/me");
  renderEnrollments(data.items || []);
}

async function loadReminders() {
  if (!currentUser) return;
  const data = await request("/api/reminders/upcoming");
  renderReminders(data.items || []);
}

async function loadAllEnrollments() {
  if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "professional")) {
    return;
  }
  const data = await request("/api/enrollments/all");
  renderAllEnrollments(data.items || []);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(loginMessage, "");

  const formData = new FormData(loginForm);
  const payload = {
    email: formData.get("email"),
    password: formData.get("password")
  };

  try {
    const data = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    currentUser = data.user;
    updateUI();
    setMessage(loginMessage, "Login realizado.", true);
    await loadEvents();
    await loadMyEvents();
    await loadEnrollments();
    await loadReminders();
    await loadAllEnrollments();
  } catch (error) {
    setMessage(loginMessage, error.message);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(registerMessage, "");

  const formData = new FormData(registerForm);
  const payload = {
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role")
  };

  try {
    const data = await request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    currentUser = data.user;
    updateUI();
    setMessage(registerMessage, "Cadastro concluido.", true);
    await loadEvents();
    await loadMyEvents();
    await loadEnrollments();
    await loadReminders();
    await loadAllEnrollments();
  } catch (error) {
    setMessage(registerMessage, error.message);
  }
});

logoutBtn.addEventListener("click", async () => {
  await request("/api/auth/logout", { method: "POST" });
  currentUser = null;
  updateUI();
  await loadEvents();
});

searchBtn.addEventListener("click", async () => {
  eventsPage = 0;
  await loadEvents();
});

document.getElementById("events-prev").addEventListener("click", async () => {
  if (eventsPage <= 0) return;
  eventsPage -= 1;
  await loadEvents();
});

document.getElementById("events-next").addEventListener("click", async () => {
  eventsPage += 1;
  await loadEvents();
});

scrollEvents.addEventListener("click", () => {
  document.getElementById("events-section").scrollIntoView({ behavior: "smooth" });
});

scrollAuth.addEventListener("click", () => {
  document.getElementById("auth-section").scrollIntoView({ behavior: "smooth" });
});

eventsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action === "enroll") {
    try {
      await request(`/api/events/${button.dataset.id}/enroll`, { method: "POST", body: "{}" });
      await loadEvents();
      await loadEnrollments();
      await loadReminders();
      await loadAllEnrollments();
    } catch (error) {
      alert(error.message);
    }
  }
});

myEventsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action === "cancel") {
    const ok = confirm("Deseja cancelar este evento?");
    if (!ok) return;
    try {
      await request(`/api/events/${button.dataset.id}`, { method: "DELETE" });
      await loadMyEvents();
      await loadEvents();
      await loadAllEnrollments();
    } catch (error) {
      alert(error.message);
    }
  }
});

myEnrollmentsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action === "cancel-enrollment") {
    const ok = confirm("Deseja cancelar sua inscricao?");
    if (!ok) return;
    try {
      await request(`/api/enrollments/${button.dataset.id}/cancel`, { method: "POST" });
      await loadEnrollments();
      await loadReminders();
      await loadEvents();
      await loadAllEnrollments();
    } catch (error) {
      alert(error.message);
    }
  }
});

if (eventForm) {
  eventForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(eventMessage, "");

    const formData = new FormData(eventForm);
    const payload = {
      title: formData.get("title"),
      description: formData.get("description"),
      location: formData.get("location"),
      startAt: new Date(formData.get("startAt")).toISOString(),
      durationMinutes: Number(formData.get("durationMinutes")),
      capacity: Number(formData.get("capacity"))
    };

    try {
      await request("/api/events", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      eventForm.reset();
      setMessage(eventMessage, "Evento criado.", true);
      await loadMyEvents();
      await loadEvents();
      await loadAllEnrollments();
    } catch (error) {
      setMessage(eventMessage, error.message);
    }
  });
}

(async () => {
  await loadSession();
  await loadEvents();
  await loadMyEvents();
  await loadEnrollments();
  await loadReminders();
  await loadAllEnrollments();
})();
