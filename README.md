# luci-app

面向 OpenWrt / PonWrt 的 LuCI 插件与固件包集合，主要为 **Airoha AN758x（EN7581 / AN7583）PON 光猫机型**服务。

包按目录拆开，每个目录就是一个独立的 OpenWrt 包，可以单独取用、单独编译。

| 包 | 版本 | 作用 | 界面位置 | 额外依赖 |
|---|---|---|---|---|
| `luci-app-natmode` | 0.1.6-r1 | NAT 类型三选一：全锥形 / 受限 / 对称 | 网络 → NAT 类型 | `firewall4`、`kmod-nft-fullcone` |
| `luci-app-pon-status` | 0.4.6-r4 | PON 光模块 + 端口速率 + 连接数概览卡片 | 状态 → 概览 | `airoha-ponctl`、`jsonfilter`、`rpcd-mod-file`、`luci-mod-status` |
| `luci-app-igmpproxy` | 2.0-r1 | igmpproxy 的 Web 配置界面（IPv4 组播转发，纯 JS） | 服务 → IGMP Proxy | `rpcd-mod-file`、`igmpproxy` |
| `luci-app-ledpanel` | 1.0.0-r2 | 面板 LED 控制与语义守护（PCA9555，光信号/光纤灯按原厂语义） | 系统 → 面板 LED | `rpcd`（装了 `airoha-ponctl` 则作为兜底状态源） |


---

## 安装

### 方式一：直接装现成的包（推荐）

Release 里有每次推送自动打好的包，`snapshot` 这个 tag 始终指向最新一次构建，每个包各有 apk / ipk 两种格式：

```text
luci-app-natmode-0.1.6-r1.apk         luci-app-natmode_0.1.6-r1_all.ipk
luci-app-pon-status-0.4.6-r4.apk      luci-app-pon-status_0.4.6-r4_all.ipk
luci-app-igmpproxy-2.0-r1.apk         luci-app-igmpproxy_2.0-r1_all.ipk
luci-app-ledpanel-1.0.0-r2.apk        luci-app-ledpanel_1.0.0-r2_all.ipk
```

- **`.apk`** 给 OpenWrt **25.12 及之后**（包管理器是 apk）：

  ```sh
  apk add --allow-untrusted ./luci-app-pon-status-0.4.6-r4.apk
  ```

- **`.ipk`** 给 OpenWrt **24.10 及更早**（包管理器是 opkg）：

  ```sh
  opkg install ./luci-app-pon-status_0.4.6-r4_all.ipk
  ```

两种包都是**与架构无关的纯数据包**（noarch / `Architecture: all`），ARM64 设备通用，不用挑型号。

装之前请确认上面表格里的依赖已经在设备上。这些不在自动依赖里，得自备——`kmod-nft-fullcone` 和 `airoha-ponctl` 都随 PonWRT 源码树提供；`igmpproxy` 来自官方 packages feed，`rpcd-mod-file` 来自官方 luci feed。

`luci-app-igmpproxy` 只写配置，**不自带** igmpproxy 主程序、init 脚本、`/etc/config/igmpproxy`（该文件由主程序包提供）和防火墙规则；装之前请先装好 `igmpproxy`，否则页面能打开但服务起不来。

装完清一下 LuCI 缓存再刷新页面：

```sh
rm -f /tmp/luci-indexcache.*; rm -rf /tmp/luci-modulecache/
```

### 方式二：编进固件

把需要的包目录整个拷到源码树的 `package/` 下（例如 `package/luci-app-pon-status/`），然后：

```sh
./scripts/feeds update -a && ./scripts/feeds install -a
make menuconfig          # LuCI → Applications 里勾选
make package/luci-app-pon-status/compile V=s
```

`luci-app-igmpproxy` 是纯 JS（`form.Map` + `menu.d`），不依赖 `luci-lua-runtime`，24.10 与 25.12 都能编进固件；按 `y` 进镜像、按 `m` 只生成安装包。

`h3c-fmcs-firmware` 不在 Firmware 分类里默认可见，需要 `make menuconfig` 时手动打开，且只在 airoha target 下才会出现。它**没有出现在 Release 产物里**（见下方「自动构建」），只能自己编译进固件。

---

## 各包说明

### luci-app-natmode —— NAT 类型选择器

在 **网络 → NAT 类型** 里切换三种模式，底层是写 `firewall.@defaults[0]` 并操作 nftables：

- **全锥形（NAT1）**：开 `fullcone=1`。端点无关映射 + 端点无关过滤，P2P、主机游戏、PT、PCDN 最优。
- **受限型（NAT3）**：netfilter 默认行为，删掉 `fullcone` 即可。
- **对称型（NAT4）**：往 fw4 的 `srcnat_*` 链插入 `masquerade fully-random`，端口完全随机。

两个可选开关：

- `fullcone6`（默认 0）：是否对 IPv6 也开 FullCone。IPv6 一般不做 NAT，收益有限，少数运营商环境下还会导致 IPv6 连接异常，所以默认关。仅在全锥形下生效。
- `auto_offload`（默认 0）：应用 NAT4 时自动关闭路由/NAT 卸载。**这个默认值的含义要特别注意**，见下方提示。

服务 `START=99`，刻意排在 fw4（`START=19`）之后——NAT4 的随机端口规则要插进 fw4 生成的链，链还没生成时注入等于没注入。另外挂了 `interface.*` 触发器：WAN 上线（尤其 PPPoE）会触发 fw4 整表重建，把开机注入的规则抹掉，所以接口事件后延迟 5 秒重跑一次。

### luci-app-pon-status —— PON 概览卡片

在 **状态 → 概览** 加一张「PON 光模块」卡片，显示：

- **光模块读数**：收光功率、发光功率、光模块温度、偏置电流、供电电压，来自 `ponctl status --json` 的 `frontend` 段（`schema_version` 必须为 1）。
- **端口速率**：上行 / 下行，单位 Mibit/s。取相邻两次采样的字节差除以实际经过的时间，口径与「Pon 端口速率」卡一致（上行取 tx、下行取 rx）。计数回绕或接口重启导致差值为负时判定为无效读数，不显示假的尖峰。
- **连接数**：TCP / UDP 总数，以及其中被卸载接管的子集。

取数有两套来源：优先走 ubus `network.device status`（由 luci-base 的 ACL 组授权），拿不到时退回 sysfs 直读。第一次成功的来源会被记住，之后不再重复探测。

连接数必须走 helper 脚本 `ponstat-conn`：`/proc/net/nf_conntrack` 是 `st_size` 为 0 的伪文件，rpcd 的 `file.read` 对这种文件只返回前 4 KiB，数不完整个表。脚本同时兼容内核 5.4 的 `[OFFLOAD]` 和 5.13+ 的 `[HW_OFFLOAD]` 两种标记写法。conntrack 不可读时卡片显示「不可用」，而不是一个假的 0。

### luci-app-igmpproxy —— IGMP Proxy 配置界面

在 **服务 → IGMP Proxy** 编辑 `/etc/config/igmpproxy`：快速离开、`phyint` 上下游接口、防火墙区域、`altnet` 放行网络段；页面同时显示实际生效的 `/var/etc/igmpproxy.conf` 与服务状态，点「保存并应用」会自动重启 igmpproxy。**状态 → 概览** 另有一张配置摘要卡片。

纯 JS（`form.Map`）实现，不依赖 `luci-lua-runtime`，24.10 / 25.12 均可用。只写配置，不自带 igmpproxy 主程序、init 脚本、防火墙规则，也不自带 `/etc/config/igmpproxy`（由主程序包提供，避免 conffiles 冲突）。

排障要点：

- `network` 填 UCI 接口别名（`wan` / `lan` / `iptv`），**不要**直接填 `br-lan`；官方 init 通过 ubus 按网络名解析 `l3_device`，接口没 up 会静默跳过该行。
- 必须至少有一行 `upstream`，否则 `start_service` 直接返回、服务不启动。`zone` 要填真实防火墙区域，官方 init 会据此生成 IGMP ACCEPT 与 `224.0.0.0/4` 放行规则。
- `altnet` 填的是**组播流的源 IP 网段**（运营商服务器的单播地址），不是 `239.x.x.x` 这类频道组播组地址。未知时先用 `0.0.0.0/0` 排障，能播后看 `logread | grep igmpproxy` 里 `is not in any valid net` 报出的源地址再收紧；少数版本对 `/0` 解析有问题，可拆成 `0.0.0.0/1` + `128.0.0.0/1`。
- 页面不提供「日志级别」字段，需要详细日志时 SSH 执行 `uci set igmpproxy.@igmpproxy[0].verbose='3'; uci commit igmpproxy` 再重启服务（官方 init 映射为 `-v -v`）。
- 还要在 LAN 桥上开 IGMP Snooping，否则组播会在内网泛洪。原生组播不适合 WiFi，无线观看需另配 `udpxy` / `msd_lite` 转单播；播放地址是原始 `rtp://239.x.x.x:port`。**仅支持 IPv4**。


### luci-app-ledpanel —— 面板 LED 控制（PCA9555）

给 **AN4475-G2** 用的。同为 PCA9555 面板的 HG5382A 等机型脚位不同，装上只会把灯点错——
要移植得先按 `debugfs` 的 `2-0020` 段改 `ledpaneld` 里的 `led_spec`。

这块板的面板 14 颗灯挂在 I2C 扩展器（`2-0020`）上，电源灯在 SoC GPIO35。页面在 **系统 → 面板 LED**，可以逐颗改模式、试亮 5 秒、看实时状态，也能一键全部常亮/常灭/恢复自动。

它不只是个「点灯器」，核心是 `/usr/sbin/ledpaneld` 这个守护按语义下发状态：

| 灯 | sysfs | 自动模式下的表现 |
|---|---|---|
| 电源 | `green:power` | 常亮 |
| 光信号 | `red:los` | **无光 1Hz 闪红**；有光熄灭 |
| 光纤 | `green:wan-online` | 无光灭；有光未注册 1Hz 闪；`onu_state=O5` 常亮 |
| 下行 PON | `green:pon-downlink` | 配置的 netdev carrier |
| 系统（绿/红） | `green:sys` / `red:sys` | 常亮 / 常灭 |
| VPN | `green:vpn` | 配置的隧道接口 up 时亮 |
| WLAN | `green:wlan` | 有终端关联时亮 |
| USB / USB2 | `green:usb-1` / `green:usb-2` | 按链路速率分：USB2.0 侧（≤480M）/ SuperSpeed 侧（>480M） |
| 2.5G 光口 | `green:2g5-fiber` | SFP 口 carrier |
| 语音 1–4 | `green:voice1..4` | 本机型 FXS 无 sysfs 状态源，默认不亮（不做假指示） |

**为什么要在用户态做**：这块板是贴片 paged BOSA，没有 SFP EEPROM，数字 PON PHY 的 `SFP_STA` bit0 恒为 0，驱动据此算出的 `optical_signal` 恒为「有光」。于是 DTS 里即使绑了 `pon0-los` / `pon0-online`，红灯拔纤也不会亮、光纤灯也不闪。本包绕开那个假信号，直接读收光功率与注册态自己判断：优先取 debugfs 的
`frontend` / `registration` / `line` / `pcs`（当前内核没有汇总的 `status` 文件），
把 8472 原始寄存器按 `dBm = 10*log10(raw) - 40` 换算；debugfs 不可读时才退回
`ponctl status`，所以**没装 `airoha-ponctl` 也能正常工作**。

灯名与 sysfs 的映射只维护在 `ledpaneld` 里一份，rpcd 后端通过 `ledpaneld spec` 取，页面再从后端拿，不会出现两处映射漂移。

排障要点：

- 无光阈值默认 **-25 dBm**（`los_rx_threshold`）。如果这条线实际收光在 -27 ～ -25 之间会误判成无光，按实测值调低即可。
- 守护 `START=99`，必须排在 `/etc/init.d/led` 之后，否则 gpio-leds 的默认触发器会把刚写好的状态顶回去。
- 面板灯是**低有效**，且 `led core` 对「写入与当前相同的 brightness」会短路，所以测试时别只用 `cat brightness` 判断，要连 `trigger` 一起看（`timer` 表示正在闪）。
- `voice_hook` 规则留了 `voice_cmd` 外部命令钩子，能拿到摘挂机状态时配上去就会亮；默认空着，灯保持熄灭。


## 自动构建

`.github/workflows/build.yml` 在每次推送后跑两类任务：

1. **质量校验**：LuCI 包结构检查、ShellCheck（error 级别阻断、warning 级别只提示）、JSON 语法校验。
2. **打包**（不拉 SDK、不用 docker，几分钟出结果）：
   - `build-apk`：用 apk-tools 官方静态二进制的 `apk mkpkg` 组装，产物给 OpenWrt 25.12+。
   - `build-ipk`：用 tar 按 opkg 格式手工组装，`Architecture` 写 `all`，产物给 24.10 及更早。



## 授权

LuCI 应用与脚本：**Apache-2.0**。

完整许可证文本见 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)。
