// SPDX-License-Identifier: Apache-2.0
//

// 纯 JS 版配置页（form.Map），替代原来的 Lua CBI。
// 不再需要 luci-lua-runtime / lua / libubus-lua 等任何 Lua 组件。

'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';

function effectiveBlock(text) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', _('当前生效配置 (/var/etc/igmpproxy.conf)')),
		E('pre', {}, text.trim() || _('（尚未生成，请确认 igmpproxy 已安装并启动）'))
	]);
}

function statusBlock(res) {
	var out = (res && (res.stdout || res.stderr)) ? (res.stdout || res.stderr).trim()
		: _('（无法读取服务状态）');
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', _('服务状态')),
		E('pre', {}, out)
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(uci.load('igmpproxy'), null),
			L.resolveDefault(uci.load('network'), null),
			L.resolveDefault(uci.load('firewall'), null),
			L.resolveDefault(fs.read('/var/etc/igmpproxy.conf'), ''),
			L.resolveDefault(fs.exec('/etc/init.d/igmpproxy', [ 'status' ]), null)
		]).then(function(res) {
			var nets = [], zones = [];
			try {
				nets = (uci.sections('network', 'interface') || []).map(function(s) {
					return s['.name'];
				}).filter(function(n) { return !!n; });
			} catch (e) {}
			try {
				zones = (uci.sections('firewall', 'zone') || []).map(function(s) {
					return s.name || s['.name'];
				}).filter(function(n) { return !!n; });
			} catch (e) {}

			return {
				nets: nets,
				zones: zones,
				effective: res[3] || '',
				status: res[4]
			};
		});
	},

	render: function(data) {
		data = data || { nets: [], zones: [], effective: '', status: null };

		var m = new form.Map('igmpproxy', _('IGMP Proxy 设置'),
			_('配置 igmpproxy 实现 IPv4 组播转发（常用于运营商 IPTV）。')
			+ _('本页只写 UCI 配置；点「保存并应用」后会自动重启 igmpproxy。')
			+ _('防火墙放行、IGMP Snooping、udpxy / msd_lite 需另行配置。'));

		// ---------- 常规设置 ----------
		var s = m.section(form.TypedSection, 'igmpproxy', _('常规设置'));
		s.anonymous = true;
		s.addremove = false;

		var o = s.option(form.Flag, 'quickleave', _('快速离开'),
			_('下游设备离开组播组时立即向上游发送 IGMP Leave，缩短换台延迟。'));
		o.default = '1';
		o.rmempty = false;

		// 官方 igmpproxy.init 会读取 UCI 的 verbose（0→-d、2→-v、3→-v -v，
		// 1 为默认）。本页暂不暴露该字段；form.Map 不会删除已有 option，
		// 需要详细日志时用 uci set igmpproxy.@igmpproxy[0].verbose='3' 即可。

		// ---------- 接口设置 ----------
		var s2 = m.section(form.TypedSection, 'phyint', _('接口配置'),
			_('上行连接组播来源，下行连接接收设备。')
			+ _('network 请填 UCI 网络别名（wan / lan / iptv），不要直接填 br-lan：')
			+ _('官方 init 通过 ubus 按网络名解析 l3_device，填错会静默跳过该行。'));
		s2.addremove = true;
		s2.anonymous = false;

		o = s2.option(form.ListValue, 'direction', _('方向'),
			_('只有 upstream / downstream 会写进 /var/etc/igmpproxy.conf。'));
		o.value('upstream', _('上行（连接组播来源）'));
		o.value('downstream', _('下行（连接接收设备）'));
		o.value('disabled', _('禁用（不参与组播）'));
		o.default = 'downstream';
		o.rmempty = false;

		o = s2.option(form.Value, 'network', _('网络接口'),
			_('可自由输入。可用网络别名：')
			+ (data.nets.length ? data.nets.join(', ') : _('（读取失败）')));
		o.placeholder = 'wan / lan / iptv';
		o.rmempty = true;

		o = s2.option(form.Value, 'zone', _('防火墙区域'),
			_('可自由输入。可用区域：')
			+ (data.zones.length ? data.zones.join(', ') : _('（读取失败）'))
			+ _('。官方 init 会据此生成 IGMP ACCEPT 与 224.0.0.0/4 放行规则，留空可能导致无法播放。'));
		o.placeholder = 'wan / lan';
		o.rmempty = true;

		o = s2.option(form.DynamicList, 'altnet', _('放行网络段'),
			_('仅对上行接口有效，可填多个。')
			+ _('建议先看 logread 里 "The source address ... is not in any valid net"')
			+ _(' 拿到运营商真实源网段后收紧；排障阶段可临时用 0.0.0.0/0，正常后务必收窄。'));
		o.placeholder = '例如: 10.0.0.0/8';
		o.rmempty = true;
		o.depends('direction', 'upstream');

		// ---------- 保存并应用后重启服务 ----------
		// 沿用本仓库 luci-app-natmode 的 hook 写法：包住 ui.changes.apply，
		// 等 UCI 变更提交完再重启，避免用旧配置启动。
		var origApply = (ui.changes && typeof ui.changes.apply === 'function')
			? ui.changes.apply : null;

		if (origApply && !ui.changes.__igmpproxyRestartHooked) {
			ui.changes.__igmpproxyRestartHooked = true;
			ui.changes.apply = function() {
				var args = arguments;
				return origApply.apply(ui.changes, args).then(function(res) {
					return L.resolveDefault(
						fs.exec('/etc/init.d/igmpproxy', [ 'restart' ]), null)
						.then(function(r) {
							if (!r || r.code !== 0)
								ui.addNotification(null,
									E('p', _('配置已保存，但重启 igmpproxy 失败，请手动执行 /etc/init.d/igmpproxy restart')),
									'warning');
							else
								ui.addNotification(null,
									E('p', _('配置已保存，igmpproxy 已重启。')), 'success');
						})
						.catch(function() {
							ui.addNotification(null,
								E('p', _('配置已保存，但无法调用重启（rpcd 权限不足），请手动重启 igmpproxy')),
								'warning');
						})
						.then(function() { return res; });
				});
			};
		}

		return m.render().then(function(nodes) {
			var kids = [ effectiveBlock(data.effective), statusBlock(data.status) ];
			if (Array.isArray(nodes))
				kids = kids.concat(nodes);
			else if (nodes != null)
				kids.push(nodes);
			return E('div', { 'class': 'igmpproxy-page' }, kids);
		});
	}
});
