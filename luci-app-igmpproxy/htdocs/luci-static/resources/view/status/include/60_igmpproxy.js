// 授权提示：本文件随第三方 luci-app-igmpproxy 源码一起并入本仓库，
// 上游未声明 License；合并前请先确认授权，再决定是否补 SPDX 头。
//
// 「状态 → 概览」的只读卡片：显示 /etc/config/igmpproxy 的当前配置摘要。
// 配置编辑在「服务 → IGMP Proxy」的 Lua CBI 页面完成，这里不写 UCI。

'use strict';
'require baseclass';
'require uci';

function dirLabel(dir) {
	switch (dir) {
		case 'upstream':   return _('上行（组播来源）');
		case 'downstream': return _('下行（接收设备）');
		case 'disabled':   return _('禁用');
		default:           return dir || '-';
	}
}

return baseclass.extend({
	title: _('IGMP Proxy'),

	load: function() {
		return L.resolveDefault(uci.load('igmpproxy'), null).then(function() {
			try {
				var cfg = uci.sections('igmpproxy', 'igmpproxy')[0] || {};
				var phy = uci.sections('igmpproxy', 'phyint') || [];
				return {
					quickleave: (cfg.quickleave != null) ? cfg.quickleave : '0',
					phy: phy
				};
			} catch (e) {
				return null;
			}
		});
	},

	render: function(data) {
		if (!data)
			return null;

		var rows = [
			_('快速离开'),
			(data.quickleave === '1' || data.quickleave === 1) ? _('启用') : _('关闭')
		];

		data.phy.forEach(function(s, i) {
			rows.push(
				_('接口 %d').format(i + 1),
				'%s · %s%s'.format(
					s.network || '-',
					dirLabel(s.direction),
					s.zone ? ' · ' + s.zone : '')
			);
		});

		if (!data.phy.length)
			rows.push(_('接口'), _('尚未配置（服务 → IGMP Proxy）'));

		return E('div', { 'class': 'ifacebox' }, [
			E('div', { 'class': 'ifacebox-head center active' },
				E('strong', _('IGMP Proxy'))),
			E('div', { 'class': 'ifacebox-body left' },
				L.itemlist(E('span'), rows))
		]);
	}
});
