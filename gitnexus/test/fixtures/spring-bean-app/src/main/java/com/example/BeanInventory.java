package com.example;

import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Controller;
import org.springframework.stereotype.Repository;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@Component
class WidgetComponent {}

@Service
class BillingService {}

@Repository
class WidgetRepository {}

@Controller
class PageController {}

@RestController
class ApiController {
  @GetMapping("/ping")
  String ping() {
    return "pong";
  }
}

@Configuration
class AppConfiguration {}

class PlainUtility {}
