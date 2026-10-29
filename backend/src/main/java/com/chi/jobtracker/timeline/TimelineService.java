package com.chi.jobtracker.timeline;

import com.chi.jobtracker.common.ApiException;
import com.chi.jobtracker.position.PositionService;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TimelineService {

    private final TimelineEventRepository eventRepository;
    private final PositionService positionService;

    public TimelineService(TimelineEventRepository eventRepository, PositionService positionService) {
        this.eventRepository = eventRepository;
        this.positionService = positionService;
    }

    @Transactional(readOnly = true)
    public List<TimelineDtos.Response> list(UUID userId, UUID positionId) {
        positionService.requirePosition(userId, positionId);
        return eventRepository.findByPositionIdOrderByOccurredOnAscCreatedAtAsc(positionId)
            .stream()
            .map(TimelineDtos.Response::from)
            .toList();
    }

    @Transactional
    public TimelineDtos.Response add(UUID userId, UUID positionId, TimelineDtos.Request request) {
        positionService.requirePosition(userId, positionId);
        TimelineEvent event = new TimelineEvent();
        event.setPositionId(positionId);
        event.setOccurredOn(request.occurredOn());
        event.setStage(request.stage() == null ? "other" : request.stage());
        event.setResult(request.result() == null ? "" : request.result());
        event.setNote(request.note() == null ? "" : request.note().trim());
        eventRepository.save(event);
        return TimelineDtos.Response.from(event);
    }

    @Transactional
    public void delete(UUID userId, UUID positionId, UUID eventId) {
        positionService.requirePosition(userId, positionId);
        TimelineEvent event = eventRepository.findByIdAndPositionId(eventId, positionId)
            .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "进展记录不存在"));
        eventRepository.delete(event);
    }
}
