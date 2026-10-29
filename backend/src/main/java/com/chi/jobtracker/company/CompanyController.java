package com.chi.jobtracker.company;

import com.chi.jobtracker.common.AuthUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/companies")
public class CompanyController {

    private final CompanyService companyService;

    public CompanyController(CompanyService companyService) {
        this.companyService = companyService;
    }

    @GetMapping
    public List<CompanyDtos.Response> list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String keyword) {
        return companyService.list(AuthUser.id(jwt), keyword);
    }

    @GetMapping("/{companyId}")
    public CompanyDtos.Response get(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID companyId) {
        return companyService.get(AuthUser.id(jwt), companyId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CompanyDtos.Response create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CompanyDtos.Request request) {
        return companyService.create(AuthUser.id(jwt), request);
    }

    @PatchMapping("/{companyId}")
    public CompanyDtos.Response update(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID companyId,
            @Valid @RequestBody CompanyDtos.Request request) {
        return companyService.update(AuthUser.id(jwt), companyId, request);
    }

    @DeleteMapping("/{companyId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID companyId) {
        companyService.delete(AuthUser.id(jwt), companyId);
    }
}
