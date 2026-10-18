pm.test('Health endpoint returns 200', () => pm.response.to.have.status(200));
pm.test('Process is ready', () => pm.expect(pm.response.json().ok).to.equal(true));
pm.test('Room count is non-negative', () => {
  const count = pm.response.json().rooms;
  pm.expect(Number.isInteger(count)).to.equal(true);
  pm.expect(count).to.be.at.least(0);
});
