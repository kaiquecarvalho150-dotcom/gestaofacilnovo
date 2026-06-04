const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ========== CONFIGURAÇÃO DO FIREBASE ==========
// Tenta carregar credenciais de um arquivo (via Secret File) ou usa variáveis de ambiente
let serviceAccount = null;

// 1. Verifica se existe o arquivo de credenciais no caminho padrão do Secret File (Render)
const secretFilePath = '/etc/secrets/firebase.json';
if (fs.existsSync(secretFilePath)) {
    try {
        serviceAccount = JSON.parse(fs.readFileSync(secretFilePath, 'utf8'));
        console.log('✅ Credenciais carregadas do Secret File:', secretFilePath);
    } catch (err) {
        console.error('❌ Erro ao ler o Secret File:', err);
    }
}

// 2. Se não, tenta usar variáveis de ambiente (útil para desenvolvimento local)
if (!serviceAccount && process.env.FIREBASE_PRIVATE_KEY) {
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
}

if (!serviceAccount) {
    console.error('❌ Nenhuma credencial do Firebase encontrada. Encerrando.');
    process.exit(1);
}

// Inicializa o Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
});
const db = admin.database();

// ========== FUNÇÕES DE BANCO ==========
async function readCompanies() {
    const snapshot = await db.ref('companies').once('value');
    const val = snapshot.val();
    return val ? Object.values(val) : [];
}
async function getCompany(id) {
    const snapshot = await db.ref(`companies/${id}`).once('value');
    return snapshot.val();
}
async function saveCompany(company) {
    await db.ref(`companies/${company.id}`).set(company);
}
async function getAdmin() {
    const snapshot = await db.ref('admin').once('value');
    return snapshot.val();
}

async function initData() {
    const companies = await readCompanies();
    if (companies.length === 0) {
        console.log('⚙️ Criando dados iniciais...');
        const demoCompany = {
            id: 'demo001',
            companyName: 'Restaurante Demo',
            ownerName: 'João Silva',
            cnpj: '12.345.678/0001-90',
            phone: '(11) 99999-8888',
            address: 'Rua das Flores, 123 — São Paulo/SP',
            email: 'demo@gestaofacil.com',
            password: 'demo123',
            plan: 'mensal',
            planPrice: 30,
            accessDays: 30,
            startDate: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            blocked: false,
            products: [
                { id: 'p1', name: 'Hambúrguer Clássico', price: 28, cost: 12, category: 'Lanches', stock: 50, minStock: 10, description: 'Pão, carne, queijo e alface', image: '' },
                { id: 'p2', name: 'Refrigerante 350ml', price: 6, cost: 2, category: 'Bebidas', stock: 100, minStock: 20, description: 'Gelado', image: '' },
                { id: 'p3', name: 'Batata Frita', price: 16, cost: 5, category: 'Acompanhamentos', stock: 40, minStock: 10, description: 'Crocante', image: '' }
            ],
            menuItems: [
                { id: 'm1', name: 'Hambúrguer Clássico', price: 28, category: 'Lanches', description: 'Pão artesanal, carne 150g, queijo cheddar, alface e tomate', image: '' },
                { id: 'm2', name: 'Refrigerante Lata', price: 6, category: 'Bebidas', description: 'Coca, Guaraná ou Sprite', image: '' },
                { id: 'm3', name: 'Batata Frita Média', price: 16, category: 'Acompanhamentos', description: 'Com tempero especial', image: '' }
            ],
            orders: [],
            sales: [],
            employees: [
                { id: 'e1', name: 'Maria Santos', role: 'Atendente', phone: '(11) 98765-4321', salary: 1800, address: 'Rua Alameda, 45', startDate: '2023-03-01' }
            ]
        };
        const adminData = { email: 'admin@gestaofacil.com', password: '1234' };
        await db.ref('companies').set({ [demoCompany.id]: demoCompany });
        await db.ref('admin').set(adminData);
        console.log('✅ Dados iniciais criados.');
    }
}
initData();

// ========== ROTAS PÚBLICAS ==========
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

// ========== AUTENTICAÇÃO EMPRESA ==========
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

// ========== ROTAS DA EMPRESA ==========
app.get('/api/company/:id', async (req, res) => {
    const company = await getCompany(req.params.id);
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(company);
});

app.put('/api/company/:id', async (req, res) => {
    await saveCompany(req.body);
    res.json({ success: true });
});

// ========== ADMIN ==========
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    const adminData = await getAdmin();
    if (email === adminData.email && password === adminData.password) {
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
    await db.ref(`companies/${req.params.id}`).remove();
    res.json({ success: true });
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});