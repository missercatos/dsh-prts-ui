return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'prts-open', order: 20, label: 'PRTS' },
      (props) => React.createElement('a', {
        href: '/prts', target: '_blank', rel: 'noopener',
        title: 'Open the PRTS GUI in a new tab',
        style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
      }, React.createElement('span', {
        style: { width: 9, height: 9, border: '1px solid currentColor', transform: 'rotate(45deg)', display: 'inline-block' },
      })),
    ))
  },
}