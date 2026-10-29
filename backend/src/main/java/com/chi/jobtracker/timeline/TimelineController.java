package com.chi.jobtracker.timeline;

import com.chi.jobtracker.common.AuthUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/positions/{positionId}/events")
public class TimelineController {

    private final TimelineService timelineService;

    public TimelineController(TimelineService timelineService) {
        this.timelineService = timelineService;
    }

    @GetMapping
    public List<TimelineDtos.Response> list(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID positionId) {
        return timelineService.list(AuthUser.id(jwt), positionId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TimelineDtos.Response add(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID positionId,
            @Valid @RequestBody TimelineDtos.Request request) {
        return timelineService.add(AuthUser.id(jwt), positionId, request);
    }

    @DeleteMapping("/{eventId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID positionId,
            @PathVariable UUID eventId) {
        timelineService.delete(AuthUser.id(jwt), positionId, eventId);
    }
}
