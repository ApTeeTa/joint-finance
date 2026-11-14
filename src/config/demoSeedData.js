import { checkFinancialInvariants } from '../modules/financeCoreInvariants.js';

/**
 * Демонстрационный семейный бюджет (вымышленные данные).
 */
export function createDemoSeedState() {
  return {
    profile: 'husband',
    activeTab: 'accounts',
    exchangeRate: 92,
    accounts: [
      {
        id: 'demo-acc-main',
        name: 'Семейная карта',
        currency: 'RUB',
        balance: 248_500,
        owner: 'husband'
      },
      {
        id: 'demo-acc-cash',
        name: 'Наличные дома',
        currency: 'RUB',
        balance: 18_500,
        owner: 'wife'
      },
      {
        id: 'demo-acc-usd',
        name: 'Долларовый накопительный',
        currency: 'USD',
        balance: 620,
        owner: 'husband'
      }
    ],
    incomeCategories: [
      { id: 'income-salary', name: 'Зарплата', isSystem: true },
      { id: 'income-freelance', name: 'Подработка', isSystem: true },
      { id: 'income-bonus', name: 'Премия', isSystem: true },
      { id: 'income-benefits', name: 'Пособия', isSystem: true },
      { id: 'income-other', name: 'Прочий доход', isSystem: true }
    ],
    categories: [
      { id: 'demo-cat-food', name: 'Продукты', limit: 45_000, reserved: 7_500, spent: 12_200 },
      { id: 'demo-cat-home', name: 'Дом и ремонт', limit: 35_000, reserved: 4_000, spent: 8_100 },
      { id: 'demo-cat-transport', name: 'Транспорт', limit: 20_000, reserved: 2_500, spent: 5_400 },
      { id: 'demo-cat-fun', name: 'Отдых', limit: 25_000, reserved: 1_500, spent: 3_800 }
    ],
    savings: [
      {
        id: 'demo-save-vacation',
        name: 'Отпуск у моря',
        accumulated: 28_000,
        targetAmount: 80_000,
        savingType: 'recurring',
        deadlineType: 'date',
        deadlineDate: '2026-08-15'
      },
      {
        id: 'demo-save-emergency',
        name: 'Подушка безопасности',
        accumulated: 15_000,
        targetAmount: 100_000,
        savingType: 'recurring'
      }
    ],
    obligations: [
      {
        id: 'demo-obl-rent',
        name: 'Аренда квартиры',
        accountId: 'demo-acc-main',
        targetAmount: 42_000,
        reserveAmount: 42_000,
        paidUntil: '2026-12-01',
        status: 'active',
        comment: 'Демо: ежемесячно',
        payments: [
          {
            id: 'demo-pay-rent-1',
            paidAt: '2026-09-01',
            paidUntil: '2026-10-01',
            amount: 42_000,
            accountId: 'demo-acc-main',
            transactionId: 'demo-tx-rent-pay'
          },
          {
            id: 'demo-pay-rent-2',
            paidAt: '2026-10-01',
            paidUntil: '2026-11-01',
            amount: 42_000,
            accountId: 'demo-acc-main',
            transactionId: 'demo-tx-rent-pay-2'
          }
        ],
        createdAt: '2026-01-15T10:00:00.000Z'
      },
      {
        id: 'demo-obl-internet',
        name: 'Интернет и связь',
        accountId: 'demo-acc-main',
        targetAmount: 1_800,
        reserveAmount: 1_800,
        paidUntil: '2026-11-30',
        status: 'active',
        payments: [],
        createdAt: '2026-03-01T10:00:00.000Z'
      }
    ],
    debts: [
      {
        id: 'demo-debt-friend',
        type: 'owed_to_us',
        title: 'Долг от друзей (дача)',
        amount: 25_000,
        paidAmount: 10_000,
        remainingAmount: 15_000,
        accountId: 'demo-acc-main',
        status: 'active',
        createdAt: '2026-05-10T10:00:00.000Z'
      },
      {
        id: 'demo-debt-bank',
        type: 'we_owe',
        title: 'Рассрочка на технику',
        amount: 48_000,
        paidAmount: 20_000,
        remainingAmount: 28_000,
        accountId: 'demo-acc-main',
        status: 'active',
        reserved: 0,
        createdAt: '2026-04-01T10:00:00.000Z'
      }
    ],
    transactions: [
      {
        id: 'demo-tx-salary-oct',
        type: 'account_deposit',
        status: 'active',
        amount: 185_000,
        accountId: 'demo-acc-main',
        currency: 'RUB',
        incomeCategoryId: 'income-salary',
        incomeCategoryName: 'Зарплата',
        comment: 'Зарплата за октябрь',
        date: '2026-10-05',
        createdAt: '2026-10-05T09:00:00.000Z',
        author: 'husband'
      },
      {
        id: 'demo-tx-salary-sep',
        type: 'account_deposit',
        status: 'active',
        amount: 182_000,
        accountId: 'demo-acc-main',
        currency: 'RUB',
        incomeCategoryId: 'income-salary',
        incomeCategoryName: 'Зарплата',
        comment: 'Зарплата за сентябрь',
        date: '2026-09-05',
        createdAt: '2026-09-05T09:00:00.000Z',
        author: 'husband'
      },
      {
        id: 'demo-tx-freelance',
        type: 'account_deposit',
        status: 'active',
        amount: 24_000,
        accountId: 'demo-acc-main',
        currency: 'RUB',
        incomeCategoryId: 'income-freelance',
        incomeCategoryName: 'Подработка',
        comment: 'Проект выходного дня',
        date: '2026-10-18',
        createdAt: '2026-10-18T12:00:00.000Z',
        author: 'wife'
      },
      {
        id: 'demo-tx-exp-food-1',
        type: 'expense',
        status: 'active',
        amount: 4_200,
        categoryId: 'demo-cat-food',
        categoryName: 'Продукты',
        accountId: 'demo-acc-main',
        currency: 'RUB',
        date: '2026-10-12',
        createdAt: '2026-10-12T18:00:00.000Z',
        author: 'wife',
        comment: 'Супермаркет'
      },
      {
        id: 'demo-tx-exp-food-2',
        type: 'expense',
        status: 'active',
        amount: 2_850,
        categoryId: 'demo-cat-food',
        categoryName: 'Продукты',
        accountId: 'demo-acc-cash',
        currency: 'RUB',
        date: '2026-10-08',
        createdAt: '2026-10-08T11:00:00.000Z',
        author: 'husband',
        comment: 'Рынок'
      },
      {
        id: 'demo-tx-exp-transport',
        type: 'expense',
        status: 'active',
        amount: 1_200,
        categoryId: 'demo-cat-transport',
        categoryName: 'Транспорт',
        accountId: 'demo-acc-main',
        currency: 'RUB',
        date: '2026-10-15',
        createdAt: '2026-10-15T08:00:00.000Z',
        author: 'husband',
        comment: 'Бензин'
      },
      {
        id: 'demo-tx-exp-home',
        type: 'expense',
        status: 'active',
        amount: 6_500,
        categoryId: 'demo-cat-home',
        categoryName: 'Дом и ремонт',
        accountId: 'demo-acc-main',
        currency: 'RUB',
        date: '2026-09-20',
        createdAt: '2026-09-20T14:00:00.000Z',
        author: 'husband',
        comment: 'Лампы и мелочь'
      },
      {
        id: 'demo-tx-rent-pay-2',
        type: 'obligation_payment',
        status: 'active',
        amount: 42_000,
        obligationId: 'demo-obl-rent',
        obligationName: 'Аренда квартиры',
        accountId: 'demo-acc-main',
        currency: 'RUB',
        date: '2026-10-01',
        createdAt: '2026-10-01T10:00:00.000Z',
        author: 'husband'
      },
      {
        id: 'demo-tx-saving-deposit',
        type: 'saving_deposit',
        status: 'active',
        amount: 5_000,
        savingId: 'demo-save-vacation',
        accountId: 'demo-acc-main',
        currency: 'RUB',
        date: '2026-10-10',
        createdAt: '2026-10-10T19:00:00.000Z',
        author: 'wife',
        comment: 'Ежемесячный взнос'
      }
    ]
  };
}

export function assertDemoSeedInvariants(demo = createDemoSeedState()) {
  const check = checkFinancialInvariants(demo);
  if (!check.ok) {
    console.error('[demo seed] invariants failed', check.errors);
    throw new Error('Демонстрационный набор невалиден');
  }
  return demo;
}