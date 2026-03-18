import React, { useState, useEffect } from 'react';
import { fetchOrders, updateOrderStatus, cancelOrder } from '../api';

function OrderList() {
  const [orders, setOrders] = useState([]);
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [cancellingId, setCancellingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchOrders().then(data => setOrders(data));
  }, []);

  // clear alerts after a few seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const handleStatusChange = async (orderId, newStatus) => {
    await updateOrderStatus(orderId, newStatus);
    const data = await fetchOrders();
    setOrders(data);
  };

  const handleCancel = async (id) => {
    setCancellingId(id);
    setConfirmId(null);
    setMessage(null);

    try {
      const res = await cancelOrder(id);
      if (res.error) {
        setMessage({ type: 'error', text: res.error });
      } else {
        setMessage({ type: 'success', text: `Order #${id} cancelled. Stock restored.` });
        const latest = await fetchOrders();
        setOrders(latest);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Server unreachable' });
    } finally {
      setCancellingId(null);
    }
  };

  const sortedOrders = [...orders].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    if (sortField === 'total_amount') {
      aVal = parseFloat(aVal);
      bVal = parseFloat(bVal);
    }
    if (sortDir === 'asc') return aVal > bVal ? 1 : -1;
    return aVal < bVal ? 1 : -1;
  });

  const handleSort = (field) => {
    if (field === sortField) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  return (
    <div className="order-list">
      <h2>Orders ({orders.length})</h2>

      {message && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      <table className="order-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('id')} style={{ cursor: 'pointer' }}>ID</th>
            <th>Customer</th>
            <th>Product</th>
            <th onClick={() => handleSort('quantity')} style={{ cursor: 'pointer' }}>Qty</th>
            <th onClick={() => handleSort('total_amount')} style={{ cursor: 'pointer' }}>Total</th>
            <th>Status</th>
            <th onClick={() => handleSort('created_at')} style={{ cursor: 'pointer' }}>Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedOrders.map((order) => (
            <tr key={order.id}>
              <td>#{order.id}</td>
              <td>
                <div>{order.customer_name}</div>
                <small style={{ color: '#999' }}>{order.customer_email}</small>
              </td>
              <td>{order.product_name}</td>
              <td>{order.quantity}</td>
              <td>₹{parseFloat(order.total_amount).toLocaleString()}</td>
              <td>
                <span className={`status-badge status-${order.status}`}>
                  {order.status}
                </span>
              </td>
              <td>{new Date(order.created_at).toLocaleDateString()}</td>
              <td>
                {['pending', 'confirmed'].includes(order.status) ? (
                  <>
                    {confirmId === order.id ? (
                      <div className="confirm-actions">
                        <span className="confirm-text">Cancel?</span>
                        <button
                          className="confirm-yes-btn"
                          disabled={cancellingId === order.id}
                          onClick={() => handleCancel(order.id)}
                        >
                          {cancellingId === order.id ? 'Wait...' : 'Yes'}
                        </button>
                        <button
                          className="confirm-no-btn"
                          disabled={cancellingId === order.id}
                          onClick={() => setConfirmId(null)}
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        className="cancel-btn"
                        onClick={() => setConfirmId(order.id)}
                      >
                        Cancel
                      </button>
                    )}
                  </>
                ) : (
                  <span style={{ color: '#ccc' }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default OrderList;
