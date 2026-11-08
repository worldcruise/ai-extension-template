/**
 * Polar Integration Configuration
 *
 * Production checkout URLs go through sideai.app redirect routes so the
 * extension does not ship raw Polar checkout links.
 */
(typeof POLAR_CONFIG === 'undefined') && (function() {
const POLAR_CONFIG = {
    ORG_ID: '12627443-7efd-432b-ac34-271c36f2a6b9',
    LICENSE_API_URL: 'https://kuohjwgaloxhtrckqwcq.supabase.co/functions/v1',

    CHECKOUT_MONTHLY:  'https://sideai.app/checkout/monthly?utm_source=ext_checkout_config_monthly&utm_medium=chrome_extension&utm_campaign=sideai_extension',
    CHECKOUT_YEARLY:   'https://sideai.app/checkout/yearly?utm_source=ext_checkout_config_yearly&utm_medium=chrome_extension&utm_campaign=sideai_extension',
    CHECKOUT_LIFETIME: 'https://sideai.app/checkout/lifetime?utm_source=ext_checkout_config_lifetime&utm_medium=chrome_extension&utm_campaign=sideai_extension',

    CHECKOUT_URL: 'https://sideai.app/checkout/lifetime?utm_source=ext_checkout_config_default&utm_medium=chrome_extension&utm_campaign=sideai_extension',
};
(typeof window !== 'undefined' ? window : self).POLAR_CONFIG = POLAR_CONFIG;
})();
