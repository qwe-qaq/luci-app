# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for IGMP Proxy (IPv4 multicast proxy)
LUCI_URL:=https://github.com/qwe-qaq/luci-app
# 2.0 起为纯 JS/ucode 版：配置页用 form.Map，菜单走 menu.d JSON。
# 不再依赖 luci-lua-runtime，因此 25.12+ 的 ucode LuCI 也能直接用。
# luci-base 不能去掉——它是 JS 视图、form、rpcd/UCI 访问的框架本身。
# rpcd-mod-file 供 fs.read / fs.exec 使用（读生效配置、查服务状态、自动重启），
# 与 Lua 无关；仓库的 luci-app-pon-status 同样依赖它。
LUCI_DEPENDS:=+luci-base +rpcd-mod-file +igmpproxy
PKG_VERSION:=2.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0

LUCI_NAME:=luci-app-igmpproxy

# 目录里没有 luasrc/，luci.mk 的自动注入规则不会再加 +luci-lua-runtime。
# 全部内容都在 root/ 与 htdocs/，同时兼容仓库 CI 的「无 SDK」打包脚本。
#
# 刻意不提供 /etc/config/igmpproxy：官方 packages feed 的 igmpproxy 主程序包
# 已安装该文件并声明为 conffiles，两包同路径会在编固件/装包时冲突。
# 菜单由 menu.d JSON 注册（ACL 判定），不依赖配置文件是否存在。
#
# 本包只读写配置，不自带主程序、init 脚本或防火墙规则。

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage: feed scanner marker; luci.mk generates the package rules.
