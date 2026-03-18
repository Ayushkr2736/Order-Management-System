const mockData = {
  customers: [
    { id: 1, name: 'Aarav Sharma', email: 'aarav@example.com', phone: '9876543210', created_at: new Date() },
    { id: 2, name: 'Priya Patel', email: 'priya@example.com', phone: '9876543211', created_at: new Date() },
    { id: 3, name: 'Rohan Gupta', email: 'rohan@example.com', phone: '9876543212', created_at: new Date() },
    { id: 4, name: 'Sneha Reddy', email: 'sneha@example.com', phone: '9876543213', created_at: new Date() },
    { id: 5, name: 'Vikram Singh', email: 'vikram@example.com', phone: '9876543214', created_at: new Date() }
  ],
  products: [
    { id: 1, name: 'Wireless Earbuds', description: 'Bluetooth 5.0 earbuds', price: 2499.00, inventory_count: 50, created_at: new Date() },
    { id: 2, name: 'USB-C Hub', description: '7-in-1 USB-C hub', price: 1899.00, inventory_count: 30, created_at: new Date() },
    { id: 3, name: 'Mechanical Keyboard', description: 'RGB mechanical keyboard', price: 4599.00, inventory_count: 20, created_at: new Date() },
    { id: 4, name: 'Laptop Stand', description: 'Adjustable laptop stand', price: 1299.00, inventory_count: 40, created_at: new Date() },
    { id: 5, name: 'Webcam HD', description: '1080p HD webcam', price: 3499.00, inventory_count: 15, created_at: new Date() }
  ],
  orders: [
    { id: 1, customer_id: 1, product_id: 1, quantity: 2, total_amount: 4998.00, status: 'delivered', shipping_address: '42 MG Road, Bangalore', created_at: new Date() },
    { id: 2, customer_id: 2, product_id: 3, quantity: 1, total_amount: 4599.00, status: 'shipped', shipping_address: '15 Park Street, Kolkata', created_at: new Date() },
    { id: 3, customer_id: 3, product_id: 2, quantity: 3, total_amount: 5697.00, status: 'pending', shipping_address: '88 Connaught Place, Delhi', created_at: new Date() },
    { id: 4, customer_id: 1, product_id: 5, quantity: 1, total_amount: 3499.00, status: 'pending', shipping_address: '42 MG Road, Bangalore', created_at: new Date() },
    { id: 5, customer_id: 4, product_id: 4, quantity: 2, total_amount: 2598.00, status: 'confirmed', shipping_address: '23 Jubilee Hills, Hyderabad', created_at: new Date() },
    { id: 6, customer_id: 5, product_id: 1, quantity: 1, total_amount: 2499.00, status: 'shipped', shipping_address: '7 Marine Drive, Mumbai', created_at: new Date() },
    { id: 7, customer_id: 2, product_id: 2, quantity: 1, total_amount: 1899.00, status: 'delivered', shipping_address: '15 Park Street, Kolkata', created_at: new Date() },
    { id: 8, customer_id: 3, product_id: 3, quantity: 1, total_amount: 4599.00, status: 'confirmed', shipping_address: '88 Connaught Place, Delhi', created_at: new Date() }
  ]
};

const pool = {
  query: async (text, params) => {
    // Very basic mock query handler
    if (text.includes('FROM orders')) {
      const rows = mockData.orders.map(o => ({
        ...o,
        customer_name: mockData.customers.find(c => c.id === o.customer_id).name,
        customer_email: mockData.customers.find(c => c.id === o.customer_id).email,
        product_name: mockData.products.find(p => p.id === o.product_id).name,
        product_price: mockData.products.find(p => p.id === o.product_id).price
      }));
      if (text.includes('WHERE o.id = $1')) {
        const found = rows.find(r => r.id == params[0]);
        return { rows: found ? [found] : [] };
      }
      return { rows };
    }
    if (text.includes('FROM customers')) {
      if (text.includes('WHERE name ILIKE $1')) {
        const search = params[0].replace(/%/g, '').toLowerCase();
        return { rows: mockData.customers.filter(c => c.name.toLowerCase().includes(search)) };
      }
      return { rows: mockData.customers };
    }
    if (text.includes('FROM products')) {
      return { rows: mockData.products };
    }
    if (text.includes('UPDATE orders SET status = $1')) {
        const id = params[1];
        const status = params[0];
        const order = mockData.orders.find(o => o.id == id);
        if (order) {
            order.status = status;
            order.updated_at = new Date();
            return { rows: [order] };
        }
        return { rows: [] };
    }
    return { rows: [] };
  },
  connect: async () => {
    return {
      query: async (text, params) => {
          if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return;
          if (text.includes('SELECT * FROM orders WHERE id = $1 FOR UPDATE')) {
              const found = mockData.orders.find(o => o.id == params[0]);
              return { rows: found ? [found] : [] };
          }
          if (text.includes('UPDATE orders SET status = $1')) {
              const id = params[1];
              const status = params[0];
              const order = mockData.orders.find(o => o.id == id);
              if (order) {
                  order.status = status;
                  return { rows: [order] };
              }
          }
          if (text.includes('UPDATE products SET inventory_count = inventory_count + $1')) {
              const id = params[1];
              const qty = params[0];
              const prod = mockData.products.find(p => p.id == id);
              if (prod) prod.inventory_count += qty;
              return { rows: [] };
          }
          return { rows: [] };
      },
      release: () => {}
    };
  }
};

module.exports = pool;
