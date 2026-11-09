# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for IGMP Proxy (IPv4 multicast proxy)
LUCI_URL:=https://github.com/qwe-qaq/luci-app
LUCI_DEPENDS:=+luci-base +rpcd-mod-file +igmpproxy
PKG_VERSION:=2.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0

LUCI_NAME:=luci-app-igmpproxy

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage: feed scanner marker; luci.mk generates the package rules.
