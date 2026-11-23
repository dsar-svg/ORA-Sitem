export function prepare(data) {
  const names = table => new Map(data[table].map(row => [row.id,row.name]));
  const products = names('product'), clients = names('customer');
  const group = (rows,key) => {
    const result = new Map();
    for (const row of rows) {
      if (!result.has(row[key])) result.set(row[key],[]);
      result.get(row[key]).push(row);
    }
    return result;
  };
  const lines = group(data.line,'document'), payments = group(data.settlement,'document');
  return data.document.filter(d => d.state === 'posted').map(d => ({
    ...d, sign:d.kind === 'credit' ? -1 : 1, client:clients.get(d.customer),
    branch:d.branch ?? 'Sin sucursal', payments:payments.get(d.id) ?? [],
    lines:(lines.get(d.id) ?? []).map(l => ({...l,name:products.get(l.product) ?? 'Sin producto'}))
  }));
}
export const sum = rows => rows.reduce((n,r) => n + r.value,0);
export function sales(docs,month,product='') {
  return docs.filter(d => d.issued.startsWith(month)).flatMap(d => {
    if (d.net !== undefined && !product) return [{...d,value:d.sign*d.net}];
    const lines = d.lines.filter(l => !product || l.product === product);
    return lines.length ? [{...d,lines,value:d.sign*lines.reduce((n,l)=>n+l.net,0)}] : [];
  });
}
export function balances(docs,end) {
  return docs.filter(d => d.issued <= end).map(d => {
    const gross = d.gross ?? d.lines.reduce((n,l)=>n+l.net+l.tax,0);
    const paid = d.payments.filter(p=>p.posted<=end).reduce((n,p)=>n+p.amount,0);
    const days = (Date.parse(end)-Date.parse(d.due))/86400000;
    return {...d,value:(gross-paid)*d.sign,days,bucket:d.payment?'Pago sin aplicar':days<=0?'Por vencer':days<=30?'1–30 días':days<=60?'31–60 días':days<=90?'61–90 días':'Más de 90 días'};
  }).filter(d => d.value !== 0);
}
// Unapplied customer payments carry a due date in Odoo but are credits waiting to be matched, not overdue debt.
export const overdue = d => d.days > 0 && !d.payment;
export function groups(rows,key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k,[]);
    map.get(k).push(row);
  }
  return [...map].map(([name,docs])=>({name,docs,value:sum(docs)})).sort((a,b)=>b.value-a.value);
}

