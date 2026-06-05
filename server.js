const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Carrega credenciais do Firebase
let serviceAccount = null;
const secretPath = '/etc/secrets/firebase.json';
if (fs.existsSync(secretPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
    console.log('✅ Credenciais carregadas do Secret File.');
} else if (process.env.FIREBASE_PRIVATE_KEY) {
    serviceAccount = {
        type: process.env.FIREBASE_TYPE,
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
    };
    console.log('✅ Credenciais carregadas de variáveis de ambiente.');
} else {
    console.warn('⚠️ Nenhuma credencial do Firebase encontrada. O servidor rodará sem banco de dados (apenas para teste).');
}

if (serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
    console.log('✅ Firebase inicializado.');
} else {
    console.log('⚠️ Firebase não inicializado. As rotas que dependem do banco retornarão erro.');
}

const db = serviceAccount ? admin.database() : null;

// Funções auxiliares (simplificadas para teste)
async function readCompanies() {
    if (!db) return [];
    const snapshot = await db.ref('companies').once('value');
    const val = snapshot.val();
    return val ? Object.values(val) : [];
}
async function getCompany(id) {
    if (!db) return null;
    const snapshot = await db.ref(`companies/${id}`).once('value');
    return snapshot.val();
}
async function saveCompany(company) {
    if (!db) return;
    await db.ref(`companies/${company.id}`).set(company);
}
async function getAdmin() {
    if (!db) return null;
    const snapshot = await db.ref('admin').once('value');
    return snapshot.val();
}

// Rota de teste
app.get('/api/test', (req, res) => {
    res.json({ message: 'API funcionando!' });
});

// Rota pública do cardápio
app.get('/api/public/menu/:companyId', async (req, res) => {
    const company = await getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json({ menuItems: company.menuItems || [], companyName: company.companyName, address: company.address });
});

app.post('/api/public/order/:companyId', async (req, res) => {
    const company = await getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada' });
    const order = req.body;
    order.id = `OS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    order.date = new Date().toISOString();
    order.status = 'pending';
    company.orders = company.orders || [];
    company.orders.push(order);
    await saveCompany(company);
    res.json({ success: true, orderId: order.id });
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const companies = await readCompanies();
    const company = companies.find(c => c.email === email && c.password === password);
    if (!company) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (company.blocked) return res.status(403).json({ error: 'Empresa bloqueada' });
    const daysRemaining = Math.max(0, company.accessDays - Math.floor((Date.now() - new Date(company.startDate)) / 86400000));
    if (daysRemaining <= 0) return res.status(403).json({ error: 'Plano expirado' });
    res.json({ companyId: company.id });
});

app.get('/api/company/:id', async (req, res) => {
    const company = await getCompany(req.params.id);
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(company);
});

app.put('/api/company/:id', async (req, res) => {
    await saveCompany(req.body);
    res.json({ success: true });
});

app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    const adminData = await getAdmin();
    if (adminData && email === adminData.email && password === adminData.password) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});

app.get('/api/admin/companies', async (req, res) => {
    const companies = await readCompanies();
    res.json(companies);
});

app.post('/api/admin/companies', async (req, res) => {
    const newCompany = req.body;
    newCompany.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    newCompany.createdAt = new Date().toISOString();
    newCompany.startDate = new Date().toISOString();
    newCompany.products = newCompany.products || [];
    newCompany.menuItems = newCompany.menuItems || [];
    newCompany.orders = [];
    newCompany.sales = [];
    newCompany.employees = [];
    await saveCompany(newCompany);
    res.json(newCompany);
});

app.put('/api/admin/companies/:id', async (req, res) => {
    await saveCompany(req.body);
    res.json({ success: true });
});

app.delete('/api/admin/companies/:id', async (req, res) => {
    if (!db) return res.status(500).json({ error: 'Banco não disponível' });
    await db.ref(`companies/${req.params.id}`).remove();
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});