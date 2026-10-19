package com.acme;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class Customer {
    @Id
    private Long id;
    private String email;
    private String phoneNumber;
    private String plan;
}
