'use strict';
'require view';
'require rpc';
'require ui';
'require dom';
'require poll';

/*
 * 面板 LED 控制（AN4475-G2 / PCA9555）
 *
 * 灯名→sysfs 的映射在后端 ledpaneld 里，这里只负责展示与下发。
 * 注意 rpc.declare 的两条坑：
 *   1. params 必须声明（数组或对象），否则 LuCI 打包出的是空对象 {};
 *   2. ui.createHandlerFn(ctx, name, ...args) 调用处理器时是 fn(...args, ev)，
 *      事件在最后。所以下面的处理器签名里 ev 一律放末尾（或直接省略）。
 */

var callStatus = rpc.declare({
	object: 'luci.ledpanel',
	method: 'status',
	expect: { }
});

var callSet = rpc.declare({
	object: 'luci.ledpanel',
	method: 'set',
	params: { name: 'str', mode: 'str', blink_ms: 'str' }
});

var callTest = rpc.declare({
	object: 'luci.ledpanel',
	method: 'test',
	params: { name: 'str', action: 'str', seconds: 'str' }
});

var callAll = rpc.declare({
	object: 'luci.ledpanel',
	method: 'all',
	params: { action: 'str' }
});

var callSettings = rpc.declare({
	object: 'luci.ledpanel',
	method: 'settings',
	params: { key: 'str', value: 'str' }
});

var callService = rpc.declare({
	object: 'luci.ledpanel',
	method: 'service',
	params: { action: 'str' }
});

var MODES = [
	[ 'auto',  '自动（按语义）' ],
	[ 'on',    '常亮' ],
	[ 'off',   '常灭' ],
	[ 'blink', '闪烁' ]
];

function notify(kind, msg) {
	ui.addNotification(null, E('p', {}, msg), kind);
}

function fail(prefix, res) {
	notify('danger', '%s：%s'.format(prefix, (res && res.error) || _('未知错误')));
}

/* 触发器是 timer 说明正在闪，直接看 brightness 只会读到某一相 */
function stateText(led) {
	if (led.trigger === 'timer')
		return _('闪烁');
	return (Number(led.brightness) > 0) ? _('亮') : _('灭');
}

return view.extend({
	load: function() {
		return callStatus();
	},

	render: function(data) {
		var self = this;
		var leds = (data && data.leds) ? data.leds : [];
		var pon = (data && data.pon) ? data.pon : {};
		var set = (data && data.settings) ? data.settings : {};
		var running = data && data.running === 1;

		/* ---------- PON 状态卡 ---------- */
		var lightOk = Number(pon.light) === 1;
		var regOk = Number(pon.registered) === 1;

		var ponCard = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('PON 状态（决定光信号灯 / 光纤灯）')),
			E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('收光')),
					E('th', { 'class': 'th' }, _('收光功率')),
					E('th', { 'class': 'th' }, _('ONU 状态')),
					E('th', { 'class': 'th' }, _('预期表现'))
				]),
				E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, E('strong', {}, lightOk ? _('有光') : _('无光'))),
					E('td', { 'class': 'td' }, (pon.rx || '—') + ' dBm'),
					E('td', { 'class': 'td' }, (pon.onu || '—') + (regOk ? _('（已注册）') : _('（未注册）'))),
					E('td', { 'class': 'td' },
						!lightOk ? _('光信号灯 1Hz 闪红、光纤灯灭')
							: regOk ? _('光信号灯灭、光纤灯常亮')
								: _('光信号灯灭、光纤灯 1Hz 闪'))
				])
			])
		]);

		/* ---------- 灯表 ---------- */
		var rows = leds.map(function(l) {
			var modeSel = E('select', {
				'class': 'cbi-input-select',
				'change': function(ev) {
					return self.handleMode(l.name, ev.target.value);
				}
			}, MODES.map(function(m) {
				return E('option', { 'value': m[0], 'selected': (m[0] === l.mode) ? '' : null }, m[1]);
			}));

			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [
					E('strong', {}, l.name),
					' ',
					/* 脚位来自 PCA9555 实际走线，拿万用表对板子时按这个找；
					   电源灯不在扩展器上，标 SoC */
					E('span', { 'class': 'ifacebadge' }, (l.pin && l.pin !== '-') ? l.pin : 'SoC'),
					E('br'),
					E('span', { 'class': 'ifacebadge' }, l.sysfs)
				]),
				E('td', { 'class': 'td' }, l.desc),
				E('td', { 'class': 'td', 'data-state': l.name }, stateText(l)),
				E('td', { 'class': 'td' }, modeSel),
				E('td', { 'class': 'td' }, [
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': function() { return self.handleTest(l.name, 'on'); }
					}, _('试亮')),
					' ',
					E('button', {
						'class': 'cbi-button',
						'click': function() { return self.handleTest(l.name, 'blink'); }
					}, _('试闪')),
					' ',
					E('button', {
						'class': 'cbi-button cbi-button-reset',
						'click': function() { return self.handleTest(l.name, 'off'); }
					}, _('试灭'))
				])
			]);
		});

		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('灯')),
				E('th', { 'class': 'th' }, _('语义')),
				E('th', { 'class': 'th' }, _('当前')),
				E('th', { 'class': 'th' }, _('模式')),
				E('th', { 'class': 'th' }, _('试亮 5 秒'))
			])
		].concat(rows));

		/* ---------- 全局操作 ---------- */
		var actions = E('div', { 'class': 'cbi-page-actions' }, [
			E('button', { 'class': 'cbi-button cbi-button-apply',
				'click': function() { return self.handleAll('on'); } }, _('全部常亮')),
			' ',
			E('button', { 'class': 'cbi-button cbi-button-reset',
				'click': function() { return self.handleAll('off'); } }, _('全部常灭')),
			' ',
			E('button', { 'class': 'cbi-button cbi-button-action',
				'click': function() { return self.handleAll('auto'); } }, _('恢复自动语义')),
			' ',
			E('button', { 'class': 'cbi-button',
				'click': function() { return self.handleService(running ? 'restart' : 'start'); } },
				running ? _('重启守护') : _('启动守护')),
			' ',
			E('button', { 'class': 'cbi-button',
				'click': function() { return self.handleService('stop'); } }, _('停止守护')),
			' ',
			E('button', { 'class': 'cbi-button',
				'click': function() { window.location.reload(); } }, _('刷新'))
		]);

		/* ---------- 参数 ---------- */
		var settingsForm = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('判定参数')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('无光判定阈值（dBm）')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'class': 'cbi-input-text',
						'style': 'width:8em',
						'value': set.los_rx_threshold || '-25',
						'change': function(ev) { return self.handleSetting('los_rx_threshold', ev.target.value); }
					}),
					E('div', { 'class': 'cbi-value-description' },
						_('收光功率低于此值即判为无光，光信号灯开始闪。常见 GPON/XG-PON 灵敏度 -27 ～ -28，默认 -25 留有余量。'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('闪烁周期（毫秒）')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'class': 'cbi-input-text',
						'style': 'width:8em',
						'value': set.blink_ms || '500',
						'change': function(ev) { return self.handleSetting('blink_ms', ev.target.value); }
					}),
					E('div', { 'class': 'cbi-value-description' }, _('500 即 1Hz。'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('VPN 接口')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'class': 'cbi-input-text',
						'value': set.vpn_iface || '',
						'placeholder': 'wg0 tun0',
						'change': function(ev) { return self.handleSetting('vpn_iface', ev.target.value); }
					}),
					E('div', { 'class': 'cbi-value-description' }, _('空格分隔；任一接口 up 时 VPN 灯亮。留空则常灭。'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('WLAN 接口')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'class': 'cbi-input-text',
						'value': set.wlan_iface || '',
						'placeholder': 'phy0-ap0',
						'change': function(ev) { return self.handleSetting('wlan_iface', ev.target.value); }
					}),
					E('div', { 'class': 'cbi-value-description' }, _('空格分隔；有终端关联时 WLAN 灯亮。留空则常灭。'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('2.5G 光口接口')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'class': 'cbi-input-text',
						'style': 'width:10em',
						'value': set.sfp_iface || 'sfp0',
						'change': function(ev) { return self.handleSetting('sfp_iface', ev.target.value); }
					}),
					E('div', { 'class': 'cbi-value-description' }, _('carrier 为 1 时 2.5G 光口灯亮。'))
				])
			])
		]);

		/* ---------- 组装 ---------- */
		var root = E('div', {}, [
			E('h2', {}, _('面板 LED')),
			E('div', { 'class': 'cbi-section-descr' },
				_('本机型 14 颗面板灯挂在 PCA9555（i2c 2-0020）上，另有电源灯在 SoC GPIO35。') + ' ' +
				_('守护 %s 在用户态按语义下发状态。').format(running ? _('运行中') : _('未运行'))),
			actions,
			ponCard,
			E('div', { 'class': 'cbi-section' }, [ table ]),
			settingsForm
		]);

		/* 2 秒轮询刷新「当前」列，闪烁/链路变化能看出来 */
		poll.add(function() {
			return callStatus().then(function(st) {
				(st.leds || []).forEach(function(l) {
					var td = document.querySelector('td[data-state="%s"]'.format(l.name));
					if (td)
						td.textContent = stateText(l);
				});
			});
		}, 2);

		return root;
	},

	handleMode: function(name, mode) {
		return callSet({ name: name, mode: mode }).then(function(res) {
			if (!res || res.ok !== true)
				fail(_('设置失败'), res);
			else
				notify('info', _('%s → %s').format(name, mode));
		});
	},

	handleTest: function(name, action) {
		return callTest({ name: name, action: action, seconds: '5' }).then(function(res) {
			if (!res || res.ok !== true)
				fail(_('试亮失败'), res);
		});
	},

	handleAll: function(action) {
		return callAll({ action: action }).then(function(res) {
			if (!res || res.ok !== true)
				fail(_('操作失败'), res);
			else
				window.setTimeout(function() { window.location.reload(); }, 600);
		});
	},

	handleService: function(action) {
		return callService({ action: action }).then(function(res) {
			if (!res || res.ok !== true)
				fail(_('服务操作失败'), res);
			else
				window.setTimeout(function() { window.location.reload(); }, 800);
		});
	},

	handleSetting: function(key, value) {
		return callSettings({ key: key, value: value }).then(function(res) {
			if (!res || res.ok !== true)
				fail(_('保存失败'), res);
			else
				notify('info', _('已保存 %s').format(key));
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
