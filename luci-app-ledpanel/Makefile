# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI panel LED control for AN4475-G2 (PCA9555, PON LOS/WAN semantics)
LUCI_DEPENDS:=+luci-base +rpcd +ubus
PKG_VERSION:=1.0.0
PKG_RELEASE:=2

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=qwe-qaq

define Package/luci-app-ledpanel/conffiles
/etc/config/ledpanel
endef

define Package/luci-app-ledpanel/postinst
[ -n "$${IPKG_INSTROOT}" ] || { \
	chmod 0755 /usr/sbin/ledpaneld 2>/dev/null; \
	chmod 0755 /usr/libexec/rpcd/luci.ledpanel 2>/dev/null; \
	chmod 0755 /etc/init.d/ledpaneld 2>/dev/null; \
	rm -f /tmp/luci-indexcache.*; \
	rm -rf /tmp/luci-modulecache/; \
	/etc/init.d/rpcd reload 2>/dev/null; \
	exit 0; \
}
endef

define Package/luci-app-ledpanel/prerm
[ -n "$${IPKG_INSTROOT}" ] || { \
	/etc/init.d/ledpaneld stop 2>/dev/null; \
	/etc/init.d/ledpaneld disable 2>/dev/null; \
	rm -f /tmp/luci-indexcache.*; \
	rm -rf /tmp/luci-modulecache/; \
	exit 0; \
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage: feed scanner marker; luci.mk generates the package rules.
