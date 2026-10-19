package com.acme;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class BillingClient {
    private final RestTemplate rest = new RestTemplate();

    public String charges() {
        return rest.getForObject("https://api.stripe.com/v1/charges", String.class);
    }
}
